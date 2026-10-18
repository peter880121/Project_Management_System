import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const connected = vi.hoisted(() => ({ client: undefined as unknown as import("@prisma/client").PrismaClient }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return connected.client; } }));
const mockedModel = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/modules/ai/chat-model", () => ({ getConfiguredLlm: () => ({ provider: "synthetic", modelName: "fixture", model: mockedModel }) }));
vi.mock("@/modules/ai/wbs/history", () => ({ retrieveHistoricalTasks: async () => ({ tasks: [], hitIds: [], degraded: true, durationMs: 0 }) }));
import { buildDocumentChunksTick, syncDocumentVectorTick } from "@/modules/documents/rag-worker";
import { keywordEvidence, loadEvidenceByIds } from "@/modules/documents/rag-repositories";
import { documentEmbeddingModel } from "@/modules/ai/embeddings";
import { retryDocumentVectors, searchProjectDocuments } from "@/modules/documents/rag-service";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { searchDocumentVectors, upsertDocumentVector } from "@/modules/vector/documents";
import { getMilvusClient } from "@/modules/vector/client";
import { generateWbsSuggestions } from "@/modules/ai/wbs/service";
import { acceptWbsSuggestion } from "@/modules/audit/service";
if (!process.env.DATABASE_URL || !process.env.MYSQL_ROOT_PASSWORD) throw new Error("Document RAG integration requires local MySQL credentials");
const source = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Only local MySQL is allowed");
const name = `medpm_rag_it_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
const testUrl = new URL(source); testUrl.pathname = `/${name}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } }); connected.client = db;
let actorId: string; let projectId: string; let documentId: string;
const index = { embed: vi.fn(async () => Array(1536).fill(0)), upsert: vi.fn(async () => {}) };
const liveIds: string[] = [];
function sql(input: string) { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, input, stdio: "pipe" }); }
async function parsed(version: number, text = "Synthetic acceptance requirement 需求验收条件") {
  await db.$transaction(async (tx) => {
    await tx.document.update({ where: { id: documentId }, data: { parsedVersion: version, parseVersion: version, parsedText: text, parseStatus: "SUCCEEDED", parsedAt: new Date() } });
    await tx.documentParseJob.create({ data: { documentId, version, requestedById: actorId, requestKey: randomUUID(), status: "SUCCEEDED", modelVersion: "vlm", sourceSha256: "a".repeat(64), sourceFilename: "synthetic.pdf", sourceSize: 100, deadlineAt: new Date(), markdown: text, blocks: [{ text, page: 2, type: "text" }], completedAt: new Date() } });
  });
}
describe.sequential("document RAG transactions in isolated MySQL", () => {
  beforeAll(async () => {
    if (!/^medpm_rag_it_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid isolated database name");
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });
    await db.$transaction((tx) => tx.user.create({ data: { id: SYSTEM_USER_ID, email: "system@medpm.local", name: "Synthetic system", isSystem: true, status: "DISABLED" } }));
  }, 60000);
  beforeEach(async () => {
    vi.clearAllMocks(); index.embed.mockResolvedValue(Array(1536).fill(0)); index.upsert.mockResolvedValue(undefined);
    await db.$transaction(async (tx) => {
      await tx.documentChunk.updateMany({ data: { vectorStatus: "SYNCED" } });
      actorId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic PM", role: "PM", status: "ACTIVE" } })).id;
      projectId = (await tx.project.create({ data: { name: "Synthetic RAG project", ownerId: actorId } })).id;
      documentId = (await tx.document.create({ data: { projectId, filename: "synthetic.pdf", minioKey: `synthetic/${randomUUID()}`, mediaType: "application/pdf", storageStatus: "AVAILABLE" } })).id;
    });
    await parsed(1);
  });
  afterAll(async () => {
    // Only remove IDs created by the opt-in live adapter test in this isolated database.
    try { if (liveIds.length) await getMilvusClient().delete({ collection_name: "documents_v2", ids: liveIds, timeout: 10000 }); }
    finally {
      await db.$disconnect();
      try { if (/^medpm_rag_it_[a-f0-9]{32}$/.test(name)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``); }
      finally { await admin.$disconnect(); }
    }
  });
  it("builds once, retains page/hash/source and makes keyword retrieval available before embedding", async () => {
    await buildDocumentChunksTick(); await buildDocumentChunksTick();
    const chunks = await db.documentChunk.findMany({ where: { documentId } }); expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ page: 2, version: 1, vectorStatus: "PENDING", embeddingModel: documentEmbeddingModel() });
    expect(await keywordEvidence({ projectId }, "验收", 8)).toHaveLength(1);
    expect(await loadEvidenceByIds({ projectId }, [chunks[0].id])).toEqual([]);
    expect(await db.auditLog.count({ where: { entityId: documentId, action: "DOCUMENT_CHUNKED" } })).toBe(1);
    expect(index.embed).not.toHaveBeenCalled();
  });
  it("filters stale and foreign project vectors while retaining explicitly requested history", async () => {
    await buildDocumentChunksTick(); const old = await db.documentChunk.findFirstOrThrow({ where: { documentId } });
    await parsed(2, "Synthetic current acceptance requirement"); await buildDocumentChunksTick();
    await db.$transaction((tx) => tx.documentChunk.updateMany({ where: { documentId }, data: { vectorStatus: "SYNCED" } }));
    const current = await db.documentChunk.findFirstOrThrow({ where: { documentId, version: 2 } });
    expect((await keywordEvidence({ projectId }, "acceptance", 8)).map((row) => row.version)).toEqual([2]);
    expect(await loadEvidenceByIds({ projectId }, [old.id])).toEqual([]);
    expect(await loadEvidenceByIds({ projectId: randomUUID() }, [current.id])).toEqual([]);
    expect((await loadEvidenceByIds({ projectId, documentId, version: 1 }, [old.id]))[0].version).toBe(1);
    await db.$transaction((tx) => tx.documentChunk.update({ where: { id: current.id }, data: { embeddingModel: "different-space" } }));
    expect(await loadEvidenceByIds({ projectId }, [current.id])).toEqual([]);
  });
  it.runIf(process.env.RUN_LIVE_DOCUMENT_VECTOR === "1")("writes and searches the real Milvus adapter with synthetic vectors", async () => {
    await buildDocumentChunksTick(); const chunk = await db.documentChunk.findFirstOrThrow({ where: { documentId } }); liveIds.push(chunk.id);
    const embedding = Array(1536).fill(0); embedding[0] = 1;
    await syncDocumentVectorTick({ embed: async () => embedding, upsert: upsertDocumentVector });
    expect((await db.documentChunk.findUniqueOrThrow({ where: { id: chunk.id } })).vectorStatus).toBe("SYNCED");
    let ids: string[] = [];
    await vi.waitFor(async () => { ids = await searchDocumentVectors(projectId, embedding); expect(ids).toContain(chunk.id); }, { timeout: 15000, interval: 500 });
    expect((await loadEvidenceByIds({ projectId }, ids)).map((value) => value.id)).toEqual([chunk.id]);
    expect(await searchDocumentVectors(randomUUID(), embedding)).not.toContain(chunk.id);
  }, 60000);
  it("records bounded index failures and supports audited manual retry without blocking keyword search", async () => {
    await buildDocumentChunksTick(); index.embed.mockRejectedValue(new Error("secret provider body"));
    for (let attempt = 0; attempt < 5; attempt++) {
      await db.$transaction((tx) => tx.documentChunk.updateMany({ where: { documentId }, data: { nextRunAt: new Date(0) } }));
      expect(await syncDocumentVectorTick(index)).toBe(true);
    }
    const chunk = await db.documentChunk.findFirstOrThrow({ where: { documentId } });
    expect(chunk).toMatchObject({ attempts: 5, vectorStatus: "FAILED", errorCode: "DOCUMENT_VECTOR_SYNC_FAILED" });
    expect(await syncDocumentVectorTick(index)).toBe(false);
    expect(await keywordEvidence({ projectId }, "acceptance", 8)).toHaveLength(1);
    expect(await db.syncFailure.findFirstOrThrow({ where: { entityId: chunk.id } })).toMatchObject({ retryCount: 5, error: "DOCUMENT_VECTOR_SYNC_FAILED" });
    expect(await retryDocumentVectors(documentId, 1, { actorId })).toMatchObject({ queuedChunks: 1 });
    index.embed.mockResolvedValue(Array(1536).fill(0)); await syncDocumentVectorTick(index);
    expect((await db.documentChunk.findUniqueOrThrow({ where: { id: chunk.id } })).vectorStatus).toBe("SYNCED");
    expect(await db.syncFailure.count({ where: { entityId: chunk.id } })).toBe(0);
    expect(index.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: chunk.id, docId: documentId, projectId }));
  });
  it("prevents an expired worker from publishing after a recovered worker fails", async () => {
    await buildDocumentChunksTick(); let release!: (value: number[]) => void;
    index.embed.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = syncDocumentVectorTick(index); await vi.waitFor(() => expect(index.embed).toHaveBeenCalledOnce());
    await db.$transaction((tx) => tx.documentChunk.updateMany({ where: { documentId }, data: { leaseUntil: new Date(0) } }));
    await syncDocumentVectorTick({ ...index, embed: async () => { throw new Error("synthetic outage"); } });
    release(Array(1536).fill(0)); await old;
    expect(await db.documentChunk.findFirstOrThrow({ where: { documentId } })).toMatchObject({ vectorStatus: "FAILED", attempts: 1 });
  });
  it("quarantines an oversized document without starving later documents", async () => {
    await db.$transaction((tx) => tx.documentParseJob.update({ where: { documentId_version: { documentId, version: 1 } }, data: { blocks: Array.from({ length: 20001 }, () => ({ text: "synthetic", page: 1, type: "text" })) } }));
    expect(await buildDocumentChunksTick()).toBe(true);
    expect(await db.syncFailure.count({ where: { entityId: documentId, target: "DOCUMENT_CHUNK_BUILD" } })).toBe(1);
    expect(await buildDocumentChunksTick()).toBe(false);
    await parsed(2); expect(await buildDocumentChunksTick()).toBe(true);
    expect((await db.document.findUniqueOrThrow({ where: { id: documentId } })).chunkedVersion).toBe(2);
  });
  it("rechecks role and version before resetting failed chunks", async () => {
    await buildDocumentChunksTick(); await db.$transaction((tx) => tx.user.update({ where: { id: actorId }, data: { role: "QA" } }));
    await expect(retryDocumentVectors(documentId, 1, { actorId })).rejects.toMatchObject({ status: 403 });
    await db.$transaction((tx) => tx.user.update({ where: { id: actorId }, data: { role: "PM" } }));
    await expect(retryDocumentVectors(documentId, 2, { actorId })).rejects.toMatchObject({ status: 409 });
  });
  it("persists WBS document snapshots as pending and creates a task only after explicit acceptance", async () => {
    await buildDocumentChunksTick(); const chunk = await db.documentChunk.findFirstOrThrow({ where: { documentId } });
    const previousKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "";
    try {
      mockedModel.invoke.mockImplementationOnce(async (messages: { content: string }[]) => {
        const context = JSON.parse(messages[1].content);
        expect(context.documentEvidence[0]).toMatchObject({ id: chunk.id, version: 1, page: 2, textSha256: chunk.textSha256 });
        return { content: JSON.stringify({ tasks: [{ title: "Verify synthetic acceptance", description: "Review acceptance evidence with QA", estimateHours: 3, suggestedRole: "QA", dependencies: [], sourceChunkIds: [chunk.id] }] }) };
      });
      const result = await generateWbsSuggestions({ projectId, actorId, request: "Synthetic acceptance requirement" });
      expect(result.manualFallback).toBe(false); expect(result.suggestions).toHaveLength(1);
      expect(await db.task.count({ where: { projectId } })).toBe(0);
      const suggestion = await db.aiSuggestion.findUniqueOrThrow({ where: { id: result.suggestions[0].id } });
      expect(suggestion.status).toBe("PENDING"); expect(suggestion.input).toMatchObject({ documentEvidence: [expect.objectContaining({ id: chunk.id, version: 1 })] });
      await parsed(2, "Synthetic revised acceptance requirement"); await buildDocumentChunksTick();
      expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).input).toEqual(suggestion.input);
      const accepted = await acceptWbsSuggestion({ suggestionId: suggestion.id, actorId });
      expect(accepted.suggestion.output).toMatchObject({ sourceChunkIds: [chunk.id], taskId: accepted.task.id });
      expect(await db.task.count({ where: { projectId } })).toBe(1);
      expect(await db.auditLog.count({ where: { entityId: suggestion.id, action: "AI_SUGGESTION_ACCEPTED" } })).toBe(1);
    } finally { if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; }
  });
  it("rolls back chunks on audit failure and never returns unaudited retrieval", async () => {
    sql("CREATE TRIGGER rag_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure';");
    try { await expect(buildDocumentChunksTick()).rejects.toThrow(); } finally { sql("DROP TRIGGER rag_it_fail_audit;"); }
    expect(await db.documentChunk.count({ where: { documentId } })).toBe(0);
    expect((await db.document.findUniqueOrThrow({ where: { id: documentId } })).chunkedVersion).toBeNull();
    await buildDocumentChunksTick();
    const priorKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "";
    try {
      const result = await searchProjectDocuments(projectId, { query: "acceptance", limit: 8 }, { actorId, ip: "192.0.2.80", userAgent: "synthetic-rag-it" });
      expect(result.hits).toHaveLength(1); expect(result.degraded).toBe(true);
      const audit = await db.auditLog.findFirstOrThrow({ where: { projectId, action: "RAG_SEARCH" } });
      expect(audit.after).toMatchObject({ query: "acceptance", degraded: true, hitIds: result.hitIds, source: "documents" });
      sql("CREATE TRIGGER rag_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure';");
      try { await expect(searchProjectDocuments(projectId, { query: "acceptance", limit: 8 }, { actorId })).rejects.toThrow(); }
      finally { sql("DROP TRIGGER rag_it_fail_audit;"); }
    } finally { if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey; }
  });
  it("rolls back only chunk schema while keeping parse results and audit evidence", async () => {
    await buildDocumentChunksTick(); const count = await db.auditLog.count();
    const directory = "prisma/migrations/20261015030000_document_chunks/";
    sql(readFileSync(directory + "down.sql", "utf8")); expect(await db.auditLog.count()).toBe(count);
    expect(await db.documentParseJob.count({ where: { documentId, status: "SUCCEEDED" } })).toBe(1);
    sql(readFileSync(directory + "migration.sql", "utf8"));
    expect(await db.documentChunk.count()).toBe(0);
  });
});
