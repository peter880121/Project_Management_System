import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const connected = vi.hoisted(() => ({ client: undefined as unknown as import("@prisma/client").PrismaClient }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return connected.client; } }));
import { requestDocumentParse } from "@/modules/documents/parse-service";
import { runParseWorkerTick, cleanupParseArtifact } from "@/modules/documents/parse-worker";
import { ParseError, type MineruClient } from "@/modules/documents/mineru";
import { SYSTEM_USER_ID } from "@/lib/system-user";

if (!process.env.DATABASE_URL || !process.env.MYSQL_ROOT_PASSWORD) throw new Error("Parse integration requires local MySQL credentials");
const source = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Only local MySQL is allowed");
const name = `medpm_parse_it_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
const testUrl = new URL(source); testUrl.pathname = `/${name}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } }); connected.client = db;
const bytes = Buffer.from("%PDF-1.4\nSynthetic\n%%EOF");
const objects = new Map<string, Buffer>();
const mineru = { reserve: vi.fn<MineruClient["reserve"]>(), upload: vi.fn<MineruClient["upload"]>(), poll: vi.fn<MineruClient["poll"]>(), result: vi.fn<MineruClient["result"]>() };
const artifacts = { put: vi.fn(async (key: string, raw: Buffer) => { objects.set(key, raw); }), remove: vi.fn(async (key: string) => { objects.delete(key); }) };
const storage = { get: vi.fn(async () => bytes), put: vi.fn(), remove: vi.fn() };
const adapters = { mineru, storage, artifacts };
let documentId: string; let actorId: string;
const request = (expectedVersion = 0) => ({ requestKey: randomUUID(), expectedVersion, cloudProcessingConfirmed: true as const });
const actor = () => ({ actorId, ip: "192.0.2.78", userAgent: "synthetic-parse-integration" });
async function tick() { await db.$transaction((tx) => tx.documentParseJob.updateMany({ where: { documentId }, data: { nextRunAt: new Date(0) } })); return runParseWorkerTick(adapters); }
function sql(input: string) { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, input, stdio: "pipe" }); }
describe.sequential("durable MinerU jobs with isolated MySQL", () => {
  beforeAll(async () => {
    if (!/^medpm_parse_it_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid isolated database name");
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });
    await db.$transaction((tx) => tx.user.create({ data: { id: SYSTEM_USER_ID, email: "system@medpm.local", name: "Synthetic worker system", isSystem: true, status: "DISABLED" } }));
  }, 60000);
  beforeEach(async () => {
    vi.clearAllMocks(); objects.clear();
    mineru.reserve.mockResolvedValue({ batchId: "synthetic-batch", uploadUrl: "https://synthetic.aliyuncs.com/upload" });
    mineru.upload.mockResolvedValue(undefined); mineru.poll.mockResolvedValue({ state: "done", resultUrl: "https://cdn-mineru.openxlab.org.cn/result.zip" });
    mineru.result.mockResolvedValue({ markdown: "Synthetic parsed text", blocks: [{ text: "Synthetic parsed text", page: 1, type: "text" }], raw: Buffer.from("synthetic archive") });
    storage.get.mockResolvedValue(bytes);
    // Every case is isolated from previous cases' queued jobs.
    await db.$transaction(async (tx) => {
      await tx.documentParseJob.updateMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "FAILED" } });
      actorId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic PM", role: "PM", status: "ACTIVE" } })).id;
      const project = await tx.project.create({ data: { name: "Synthetic parser project", ownerId: actorId } });
      documentId = (await tx.document.create({ data: { projectId: project.id, filename: "synthetic.pdf", mediaType: "application/pdf", minioKey: `synthetic/${randomUUID()}.pdf`, storageStatus: "AVAILABLE", fileSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } })).id;
    });
  });
  afterAll(async () => {
    await db.$disconnect();
    try { if (/^medpm_parse_it_[a-f0-9]{32}$/.test(name)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``); }
    finally { await admin.$disconnect(); }
  });
  it("enqueues atomically, deduplicates request keys and refuses competing submissions", async () => {
    const input = request(); const job = await requestDocumentParse(documentId, input, actor());
    expect((await requestDocumentParse(documentId, input, actor())).id).toBe(job.id);
    await expect(requestDocumentParse(documentId, request(), actor())).rejects.toMatchObject({ status: 409 });
    expect(await db.documentParseJob.count({ where: { documentId } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: job.id, action: "DOCUMENT_PARSE_REQUESTED" } })).toBe(1);
    expect(mineru.reserve).not.toHaveBeenCalled();
  });
  it("resumes persisted phases and publishes versioned text and raw artifact together", async () => {
    const job = await requestDocumentParse(documentId, request(), actor());
    await tick(); expect((await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } })).phase).toBe("UPLOAD");
    await tick(); expect((await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } })).phase).toBe("POLL");
    await tick();
    const complete = await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(complete.status).toBe("SUCCEEDED"); expect(complete.uploadUrl).toBeNull(); expect(objects.has(complete.resultKey!)).toBe(true);
    expect(await db.document.findUniqueOrThrow({ where: { id: documentId } })).toMatchObject({ parsedVersion: 1, parsedText: "Synthetic parsed text", parseStatus: "SUCCEEDED" });
    expect(mineru.reserve).toHaveBeenCalledOnce(); expect(mineru.upload).toHaveBeenCalledOnce();
  });
  it("bounds transient retries and preserves the previous successful version after failure", async () => {
    await requestDocumentParse(documentId, request(), actor()); await tick(); await tick(); await tick();
    const job = await requestDocumentParse(documentId, request(1), actor());
    mineru.reserve.mockRejectedValue(new ParseError("MINERU_TRANSPORT", true));
    await tick(); await tick(); await tick();
    expect(await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "FAILED", attempts: 3 });
    expect(await db.document.findUniqueOrThrow({ where: { id: documentId } })).toMatchObject({ parseStatus: "FAILED", parsedVersion: 1, parsedText: "Synthetic parsed text" });
    expect((await requestDocumentParse(documentId, request(2), actor(), true)).version).toBe(3);
  });
  it("keeps pending remote jobs resumable and handles terminal provider failure", async () => {
    const job = await requestDocumentParse(documentId, request(), actor()); await tick(); await tick();
    mineru.poll.mockResolvedValueOnce({ state: "pending" }); await tick();
    expect(await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "RUNNING", phase: "POLL", attempts: 0, leaseToken: null });
    expect(mineru.result).not.toHaveBeenCalled();
    mineru.poll.mockResolvedValueOnce({ state: "failed" }); await tick();
    expect(await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "FAILED", errorCode: "MINERU_PARSE_FAILED" });
    expect((await db.document.findUniqueOrThrow({ where: { id: documentId } })).storageStatus).toBe("AVAILABLE");
  });
  it("fences an expired worker from overwriting a recovered worker's checkpoint", async () => {
    const job = await requestDocumentParse(documentId, request(), actor());
    let release!: (value: { batchId: string; uploadUrl: string }) => void;
    mineru.reserve.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = runParseWorkerTick(adapters); await vi.waitFor(() => expect(mineru.reserve).toHaveBeenCalledOnce());
    await db.$transaction((tx) => tx.documentParseJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } }));
    await runParseWorkerTick(adapters);
    release({ batchId: "stale-batch", uploadUrl: "https://synthetic.aliyuncs.com/stale" }); await old;
    expect(await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ remoteBatchId: "synthetic-batch", phase: "UPLOAD", attempts: 0 });
  });
  it("rejects changed source bytes and deadline exhaustion without deleting the PDF", async () => {
    const job = await requestDocumentParse(documentId, request(), actor()); await tick(); storage.get.mockResolvedValueOnce(Buffer.from("corrupted")); await tick();
    expect(await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "FAILED", errorCode: "PARSE_SOURCE_INTEGRITY" });
    expect(storage.remove).not.toHaveBeenCalled();
    const retry = await requestDocumentParse(documentId, request(1), actor(), true);
    await db.$transaction((tx) => tx.documentParseJob.update({ where: { id: retry.id }, data: { deadlineAt: new Date(0) } })); await tick();
    expect(await db.documentParseJob.findUniqueOrThrow({ where: { id: retry.id } })).toMatchObject({ status: "FAILED", errorCode: "MINERU_JOB_TIMEOUT" });
  });
  it("rolls back enqueue and publish when audit fails and cleans only unreferenced artifacts", async () => {
    sql("CREATE TRIGGER parse_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure';");
    try { await expect(requestDocumentParse(documentId, request(), actor())).rejects.toThrow(); }
    finally { sql("DROP TRIGGER parse_it_fail_audit;"); }
    expect(await db.documentParseJob.count({ where: { documentId } })).toBe(0);
    const job = await requestDocumentParse(documentId, request(), actor()); await tick(); await tick();
    sql("CREATE TRIGGER parse_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW BEGIN IF NEW.action = 'DOCUMENT_PARSE_SUCCEEDED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure'; END IF; END;");
    try { await tick(); } finally { sql("DROP TRIGGER parse_it_fail_audit;"); }
    expect((await db.document.findUniqueOrThrow({ where: { id: documentId } })).parsedText).toBeNull();
    expect((await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("RUNNING");
    await tick(); const result = await db.documentParseJob.findUniqueOrThrow({ where: { id: job.id } }); expect(result.status).toBe("SUCCEEDED");
    await db.$transaction((tx) => tx.syncFailure.updateMany({ where: { entityId: job.id }, data: { createdAt: new Date(0) } }));
    expect(await cleanupParseArtifact(artifacts)).toBe(true); expect(objects.size).toBe(1); expect(objects.has(result.resultKey!)).toBe(true);
  });
  it("denies inactive requesters and races of separate request keys", async () => {
    await db.$transaction((tx) => tx.user.update({ where: { id: actorId }, data: { status: "DISABLED" } }));
    await expect(requestDocumentParse(documentId, request(), actor())).rejects.toMatchObject({ status: 403 });
    await db.$transaction((tx) => tx.user.update({ where: { id: actorId }, data: { status: "ACTIVE" } }));
    const attempts = await Promise.allSettled([requestDocumentParse(documentId, request(), actor()), requestDocumentParse(documentId, request(), actor())]);
    expect(attempts.filter((value) => value.status === "fulfilled")).toHaveLength(1);
  });
  it("supports structural rollback while keeping source documents, text and audit evidence", async () => {
    await requestDocumentParse(documentId, request(), actor()); await tick(); await tick(); await tick();
    const count = await db.auditLog.count(); const directory = "prisma/migrations/20261015020000_document_parse_jobs/";
    const chunksDirectory = "prisma/migrations/20261015030000_document_chunks/";
    sql(readFileSync(chunksDirectory + "down.sql", "utf8"));
    sql(readFileSync(directory + "down.sql", "utf8")); expect(await db.auditLog.count()).toBe(count);
    const rows = await db.$queryRaw<{ parsedText: string }[]>`SELECT parsedText FROM Document WHERE id = ${documentId}`; expect(rows[0]!.parsedText).toBe("Synthetic parsed text");
    sql(readFileSync(directory + "migration.sql", "utf8"));
    sql(readFileSync(chunksDirectory + "migration.sql", "utf8"));
    expect((await db.document.findUniqueOrThrow({ where: { id: documentId } })).parseStatus).toBe("NOT_REQUESTED");
  });
});
