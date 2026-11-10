import "dotenv/config";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { syntheticDocx } from "../fixtures/docx";
const state = vi.hoisted(() => ({ db: undefined as unknown, failPublishAudit: false }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
import { uploadDocument, downloadDocument, retryDocumentCleanup } from "@/modules/documents/services";
import { requestDocumentParse } from "@/modules/documents/parse-service";
import { runParseWorkerTick } from "@/modules/documents/parse-worker";
import { buildDocumentChunksTick, syncDocumentVectorTick } from "@/modules/documents/rag-worker";
import { retrieveDocumentEvidence } from "@/modules/documents/rag-service";
import { loadEvidenceByIds, keywordEvidence } from "@/modules/documents/rag-repositories";
import { createDeliverable, mutateDeliverable, queueAssetParse } from "@/modules/assets/services";
import { type MineruClient } from "@/modules/documents/mineru";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (state.failPublishAudit && args.data.action === "DOCUMENT_PARSE_SUCCEEDED") throw new Error("Synthetic local parse audit outage"); return query(args); } } } });
const objects = new Map<string, Buffer>(); const types = new Map<string, string | undefined>();
const storage = { put: vi.fn(async (key: string, bytes: Buffer, _hash: string, mediaType?: string) => { objects.set(key, bytes); types.set(key, mediaType); }), get: vi.fn(async (key: string) => { const data = objects.get(key); if (!data) throw new Error("Missing synthetic object"); return data; }), remove: vi.fn(async (key: string) => { objects.delete(key); }) };
const mineru: MineruClient = { reserve: vi.fn(), upload: vi.fn(), poll: vi.fn(), result: vi.fn() };
let pm: string, qa: string, member: string, outsider: string, projectId: string;
const actor = () => ({ actorId: pm });
const request = () => ({ requestKey: randomUUID(), expectedVersion: 0, cloudProcessingConfirmed: false });
async function upload(extension = "md") { const bytes = extension === "docx" ? syntheticDocx() : Buffer.from("# 合成需求规格\n\n审批后建立知识索引，保留交付证据。"); const result = await uploadDocument(projectId, { filename: `合成说明.${extension}`, mediaType: "", bytes, uploadKey: randomUUID() }, actor(), storage); return { ...result, bytes }; }
async function drainChunks() { for (let i = 0; i < 30 && await buildDocumentChunksTick(); i++); }
describe.sequential("multi-format upload, review, local parsing and index with real MySQL", () => {
  beforeAll(async () => {
    if (!/^medpm_test_ia_/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) throw new Error("Requires isolated project-IA database");
    [pm, qa, member, outsider] = await db.$transaction(async tx => { const ids: string[] = []; for (const role of ["PM", "QA", "MEMBER", "QA"] as const) ids.push((await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: `Synthetic ${role}`, role, status: "ACTIVE" } })).id); return ids; });
  });
  beforeEach(async () => {
    state.failPublishAudit = false; vi.clearAllMocks();
    await db.$transaction(async tx => {
      await tx.documentParseJob.updateMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "FAILED" } });
      projectId = (await tx.project.create({ data: { name: "Synthetic multi-format project", ownerId: pm, status: "ACTIVE" } })).id;
      await tx.projectMember.createMany({ data: [qa, member].map(userId => ({ projectId, userId })) });
    });
  });
  afterAll(() => db.$disconnect());
  it.each(["docx", "txt", "text", "md"])("round-trips %s through review, local parsing, chunks and vector metadata", async extension => {
    const uploaded = await upload(extension); const doc = await db.document.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(types.get(doc.minioKey)).toBe(doc.mediaType); expect(doc.minioKey.endsWith(`.${extension}`)).toBe(true);
    const draft = await createDeliverable(projectId, { name: "合成交付物", documentId: doc.id }, actor());
    await expect(requestDocumentParse(doc.id, request(), actor())).rejects.toMatchObject({ status: 409 });
    expect(await db.documentParseJob.count({ where: { documentId: doc.id } })).toBe(0);
    await mutateDeliverable(draft.id, "submit", { rowVersion: 1, cloudProcessingConfirmed: false }, actor());
    await expect(mutateDeliverable(draft.id, "review", { rowVersion: 2, decision: "APPROVED" }, actor())).rejects.toMatchObject({ status: 403 });
    await expect(mutateDeliverable(draft.id, "review", { rowVersion: 2, decision: "APPROVED" }, { actorId: outsider })).rejects.toMatchObject({ status: 403 });
    await mutateDeliverable(draft.id, "review", { rowVersion: 2, decision: "APPROVED" }, { actorId: qa });
    const job = await db.documentParseJob.findFirstOrThrow({ where: { documentId: doc.id } }); expect(job).toMatchObject({ provider: "local-document-v1", phase: "LOCAL", status: "QUEUED" });
    await runParseWorkerTick({ mineru, storage }); expect(mineru.reserve).not.toHaveBeenCalled();
    expect(await db.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ parseStatus: "SUCCEEDED", parsedVersion: 1 });
    const parsed = await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } }); expect(parsed.resultKey).toBeNull(); expect(parsed.resultSha256).toMatch(/^[a-f0-9]{64}$/);
    await drainChunks(); const upsert = vi.fn(async () => {}); for (let i = 0; i < 30 && await syncDocumentVectorTick({ embed: async () => Array(1536).fill(0.1), upsert }); i++);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ projectId, docId: doc.id, documentType: "DELIVERABLE", deliverableId: draft.id, visibleRoles: ["ADMIN", "PM", "QA", "MEMBER"] }));
    const chunks = await db.documentChunk.findMany({ where: { documentId: doc.id } }); expect(chunks.length).toBeGreaterThan(0); expect(chunks.every(chunk => chunk.vectorStatus === "SYNCED" && chunk.page === null)).toBe(true);
    const scope = { projectId, documentId: doc.id, role: "MEMBER" };
    const retrieval = { embed: async () => Array(1536).fill(0.1), search: async () => chunks.map(chunk => chunk.id), load: loadEvidenceByIds, keyword: keywordEvidence };
    expect((await retrieveDocumentEvidence(scope, "合成", 8, retrieval)).degraded).toBe(false);
    const fallback = await retrieveDocumentEvidence(scope, "合成", 8, { ...retrieval, search: async () => { throw new Error("synthetic vector outage"); } });
    expect(fallback.degraded).toBe(true); expect(fallback.hits.some(hit => hit.documentId === doc.id)).toBe(true);
    const download = await downloadDocument(doc.id, { actorId: member }, storage); expect(download.bytes).toEqual(uploaded.bytes); expect(createHash("sha256").update(download.bytes).digest("hex")).toBe(doc.sha256);
    expect((await db.auditLog.findFirstOrThrow({ where: { entityId: job.id, action: "DOCUMENT_PARSE_REQUESTED" } })).after).toMatchObject({ cloudProcessingConfirmed: false, provider: "local-document-v1" });
  });
  it("requires cloud consent for PDF and does not enqueue a local job on a disguised type", async () => {
    const pdf = await uploadDocument(projectId, { filename: "synthetic.pdf", mediaType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nsynthetic"), uploadKey: randomUUID() }, actor(), storage);
    await expect(requestDocumentParse(pdf.id, request(), actor())).rejects.toMatchObject({ status: 400 });
    const draft = await createDeliverable(projectId, { documentId: pdf.id, name: "PDF evidence" }, actor());
    await expect(mutateDeliverable(draft.id, "submit", { rowVersion: 1, cloudProcessingConfirmed: false }, actor())).rejects.toMatchObject({ status: 400 });
    await expect(uploadDocument(projectId, { filename: "spoof.docx", mediaType: "", bytes: Buffer.from("not zip"), uploadKey: randomUUID() }, actor(), storage)).rejects.toMatchObject({ status: 415 });
  });
  it("denies MEMBER and cross-project upload/parse without modifying storage", async () => {
    const uploaded = await upload(); const putCalls = storage.put.mock.calls.length;
    for (const actorId of [member, outsider]) await expect(requestDocumentParse(uploaded.id, request(), { actorId })).rejects.toMatchObject({ status: 403 });
    await expect(uploadDocument(projectId, { filename: "a.txt", mediaType: "", bytes: Buffer.from("synthetic"), uploadKey: randomUUID() }, { actorId: member }, storage)).rejects.toMatchObject({ status: 403 });
    expect(storage.put.mock.calls.length).toBe(putCalls);
  });
  it("publishes no partial result when parse audit fails, and retries the same job", async () => {
    const doc = await upload(); await requestDocumentParse(doc.id, request(), actor()); state.failPublishAudit = true;
    await runParseWorkerTick({ mineru, storage }); expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).parsedVersion).toBeNull(); expect(await db.documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
    state.failPublishAudit = false; await db.$transaction(tx => tx.documentParseJob.updateMany({ where: { documentId: doc.id }, data: { nextRunAt: new Date(0) } })); await runParseWorkerTick({ mineru, storage }); expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).parseStatus).toBe("SUCCEEDED");
    expect(await db.auditLog.count({ where: { entityType: "DocumentParseJob", projectId, action: "DOCUMENT_PARSE_SUCCEEDED" } })).toBe(1);
  });
  it("cleans a failed non-PDF object only within its verified document key", async () => {
    const doc = await upload("txt"); const row = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    await db.$transaction(tx => tx.document.update({ where: { id: doc.id }, data: { storageStatus: "FAILED" } }));
    expect(await retryDocumentCleanup(doc.id, actor(), storage)).toEqual({ removed: 1 }); expect(objects.has(row.minioKey)).toBe(false);
  });
  it("blocks previously parsed draft assets from indexing and retries a failed approved vector sync", async () => {
    const doc = await upload(); await requestDocumentParse(doc.id, request(), actor()); await runParseWorkerTick({ mineru, storage });
    const draft = await createDeliverable(projectId, { name: "Local parsed draft", documentId: doc.id }, actor());
    await drainChunks(); expect(await db.documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
    const good = { embed: async () => Array(1536).fill(0.1), upsert: async () => {} };
    for (let i = 0; i < 30 && await syncDocumentVectorTick(good); i++);
    await mutateDeliverable(draft.id, "submit", { rowVersion: 1 }, actor()); await mutateDeliverable(draft.id, "review", { rowVersion: 2, decision: "APPROVED" }, { actorId: qa });
    await drainChunks(); await syncDocumentVectorTick({ ...good, embed: async () => { throw new Error("synthetic embedding outage"); } });
    const failed = await db.documentChunk.findFirstOrThrow({ where: { documentId: doc.id, vectorStatus: "FAILED" } });
    expect(await db.syncFailure.count({ where: { entityId: failed.id } })).toBe(1);
    await db.$transaction(tx => queueAssetParse(tx, doc.id, actor(), projectId));
    for (let i = 0; i < 30 && await syncDocumentVectorTick(good); i++);
    expect(await db.documentChunk.count({ where: { documentId: doc.id, vectorStatus: { not: "SYNCED" } } })).toBe(0);
    expect(await db.syncFailure.count({ where: { entityId: failed.id } })).toBe(0);
  });
  it("preserves the original download when stored local parse source is corrupted", async () => {
    const doc = await upload(); const row = await db.document.findUniqueOrThrow({ where: { id: doc.id } }); await requestDocumentParse(doc.id, request(), actor()); objects.set(row.minioKey, Buffer.from("tampered"));
    await runParseWorkerTick({ mineru, storage }); expect(await db.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ storageStatus: "AVAILABLE", parsedVersion: null, parseStatus: "FAILED" });
    expect((await db.documentParseJob.findFirstOrThrow({ where: { documentId: doc.id } })).errorCode).toBe("PARSE_SOURCE_INTEGRITY");
    await expect(downloadDocument(doc.id, actor(), storage)).rejects.toMatchObject({ status: 503 });
  });
});
