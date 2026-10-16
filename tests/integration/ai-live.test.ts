import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const connected = vi.hoisted(() => ({ client: undefined as unknown as import("@prisma/client").PrismaClient }));
// Only redirect persistence to an isolated DB. Embedding, Milvus and chat are real.
vi.mock("@/lib/prisma", () => ({ get prisma() { return connected.client; } }));
import { embedDocumentText, documentEmbeddingModel } from "@/modules/ai/embeddings";
import { getConfiguredLlm } from "@/modules/ai/chat-model";
import { buildDocumentChunksTick, syncDocumentVectorTick } from "@/modules/documents/rag-worker";
import { searchProjectDocuments } from "@/modules/documents/rag-service";
import { generateWbsSuggestions } from "@/modules/ai/wbs/service";
import { getMilvusClient } from "@/modules/vector/client";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { upsertTaskHistoryVector } from "@/modules/vector/task-history";

describe.runIf(process.env.RUN_LIVE_AI === "1")("real configured embedding, Milvus and WBS acceptance", () => {
  let admin: PrismaClient; let db: PrismaClient; let projectId: string; let actorId: string;
  let lockDocumentId: string; let historyTaskId: string; let indexedHistory = false; const chunkIds: string[] = []; const name = `medpm_ai_live_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.MYSQL_ROOT_PASSWORD || !process.env.OPENAI_API_KEY) throw new Error("Live AI requires local DB and embedding credentials");
    const source = new URL(process.env.DATABASE_URL);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Only local MySQL test databases are allowed");
    const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
    const testUrl = new URL(source); testUrl.pathname = `/${name}`;
    admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } }); connected.client = db;
    if (!/^medpm_ai_live_[a-f0-9]{32}$/.test(name)) throw new Error("Unexpected database name");
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });
    await db.$transaction(async (tx) => {
      await tx.user.create({ data: { id: SYSTEM_USER_ID, email: "system@medpm.local", name: "Synthetic worker", isSystem: true, status: "DISABLED" } });
      actorId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic live AI PM", role: "PM", status: "ACTIVE" } })).id;
      projectId = (await tx.project.create({ data: { name: "Synthetic live AI acceptance", ownerId: actorId } })).id;
      const texts = [
        "合成医疗软件交付要求：用户连续输错口令五次后冻结账号十五分钟，管理员可审阅登录失败事件。验收需覆盖账号锁定与恢复。所有操作记录审计，不含真实患者信息。",
        "合成合规导出要求：导出需求、任务、测试追溯矩阵时记录操作者、时间和项目范围。QA 核对需求版本与测试结果，导出不改变项目状态。",
        "合成文档上传规则：PDF 上传至对象存储，校验 SHA256；解析由异步任务执行，失败可以重试。文档解析不会自动创建任务。",
      ];
      for (let index = 0; index < texts.length; index++) {
        const document = await tx.document.create({ data: { projectId, filename: `synthetic-ai-${index}.pdf`, minioKey: `synthetic-live-fixture/${randomUUID()}`, mediaType: "application/pdf", storageStatus: "AVAILABLE", parseStatus: "SUCCEEDED", parseVersion: 1, parsedVersion: 1, parsedAt: new Date(), parsedText: texts[index] } });
        if (index === 0) lockDocumentId = document.id;
        await tx.documentParseJob.create({ data: { documentId: document.id, version: 1, requestedById: actorId, requestKey: randomUUID(), status: "SUCCEEDED", modelVersion: "synthetic-normalized-fixture", sourceSha256: "a".repeat(64), sourceFilename: document.filename, sourceSize: 1, deadlineAt: new Date(), markdown: texts[index], blocks: [{ text: texts[index], page: index + 1, type: "text" }] } });
      }
      historyTaskId = (await tx.task.create({ data: { projectId, title: "合成账号锁定与恢复验收", description: "验证连续登录失败触发账号冻结和十五分钟后恢复", status: "DONE", actualHours: 8, completedAt: new Date(), createdAt: new Date(Date.now() - 2 * 86400000) } })).id;
    });
  }, 60000);
  afterAll(async () => {
    try {
      if (indexedHistory) {
        const result = await getMilvusClient().delete({ collection_name: "task_history", ids: [historyTaskId], timeout: 10000 });
        if (result.status.error_code !== "Success") throw new Error("Live history vector cleanup failed");
      }
      if (chunkIds.length) {
        const result = await getMilvusClient().delete({ collection_name: "documents", ids: chunkIds, timeout: 10000 });
        if (result.status.error_code !== "Success") throw new Error("Live test vector cleanup failed");
      }
    } finally {
      await db?.$disconnect();
      try { if (admin && /^medpm_ai_live_[a-f0-9]{32}$/.test(name)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``); }
      finally { await admin?.$disconnect(); }
    }
  }, 30000);
  it("indexes real 1536-dimensional embeddings and semantically retrieves cited evidence before generating pending WBS", async () => {
    const started = Date.now();
    let vector: number[];
    try { vector = await embedDocumentText("合成账号锁定与恢复验收"); }
    catch (error) {
      // Never expose provider bodies, request headers, URLs or credentials in failed assertions.
      const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : "unavailable";
      throw new Error(`LIVE_EMBEDDING_FAILED status=${status}`);
    }
    expect(vector.length).toBe(1536); expect(vector.every(Number.isFinite)).toBe(true);
    indexedHistory = true;
    await upsertTaskHistoryVector({ taskId: historyTaskId, projectId, embedding: vector });
    for (let index = 0; index < 3; index++) await buildDocumentChunksTick();
    const chunks = await db.documentChunk.findMany({ where: { projectId }, select: { id: true } }); chunkIds.push(...chunks.map((chunk) => chunk.id));
    expect(chunks).toHaveLength(3);
    for (let index = 0; index < chunks.length; index++) await syncDocumentVectorTick();
    expect(await db.documentChunk.count({ where: { projectId, vectorStatus: "SYNCED" } })).toBe(3);
    const retrieval = await searchProjectDocuments(projectId, { query: "多次错误凭证应如何暂时限制访问", limit: 3 }, { actorId, userAgent: "synthetic-live-ai-test" });
    console.info(JSON.stringify({ stage: "semantic-retrieval", model: documentEmbeddingModel(), mode: retrieval.mode, reason: retrieval.reason, durationMs: retrieval.durationMs, hitCount: retrieval.hits.length }));
    expect(retrieval.degraded).toBe(false); expect(retrieval.hits[0]?.documentId).toBe(lockDocumentId);
    expect(retrieval.hits[0]).toMatchObject({ version: 1, page: 1 });
    const foreign = await searchProjectDocuments(projectId, { query: "多次错误凭证应如何暂时限制访问", limit: 3, documentId: lockDocumentId }, { actorId });
    expect(foreign.hits.every((hit) => hit.documentId === lockDocumentId)).toBe(true);
    const result = await generateWbsSuggestions({ projectId, actorId, request: "请拆解合成系统账号安全交付：连续输错口令五次冻结十五分钟，提供管理员审阅失败事件与恢复验收，记录操作审计。参考项目文档及历史实际工时，不含真实患者信息。" });
    console.info(JSON.stringify({ stage: "wbs", model: getConfiguredLlm().modelName, manualFallback: result.manualFallback, suggestions: result.suggestions.length, documentEvidence: result.documentEvidence.length, historicalTasks: result.historicalTasks.length, degraded: result.degraded, durationMs: result.modelDurationMs, totalMs: Date.now() - started }));
    expect(result.manualFallback).toBe(false); expect(result.suggestions.length).toBeGreaterThan(0); expect(result.documentEvidence.length).toBeGreaterThan(0);
    expect(result.historicalTasks).toEqual([expect.objectContaining({ id: historyTaskId, actualHours: 8, deliveryDays: 2 })]);
    expect(await db.aiSuggestion.count({ where: { projectId, status: "PENDING", type: "WBS" } })).toBe(result.suggestions.length);
    expect(await db.task.count({ where: { projectId, status: { not: "DONE" } } })).toBe(0);
    const allowed = new Set(result.documentEvidence.map((source) => source.id)); let citations = 0;
    for (const suggestion of result.suggestions) {
      const output = suggestion.output as { sourceChunkIds?: string[] };
      for (const id of output.sourceChunkIds ?? []) { expect(allowed.has(id)).toBe(true); citations++; }
      const stored = await db.aiSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
      expect(stored.input).toMatchObject({ documentEvidence: result.documentEvidence });
    }
    expect(citations).toBeGreaterThan(0);
    expect(await db.auditLog.count({ where: { projectId, action: "RAG_SEARCH" } })).toBeGreaterThanOrEqual(4);
    expect(await db.auditLog.count({ where: { projectId, action: "AI_WBS_GENERATED" } })).toBe(1);
  }, 180000);
});
