import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const connected = vi.hoisted(() => ({ client: undefined as unknown as import("@prisma/client").PrismaClient }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return connected.client; } }));
import { uploadDocument, downloadDocument, recoverDocument, retryDocumentCleanup } from "@/modules/documents/services";
import type { DocumentStorage } from "@/modules/documents/storage";

if (!process.env.DATABASE_URL || !process.env.MYSQL_ROOT_PASSWORD) throw new Error("Document integration requires local MySQL credentials");
const source = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Only local MySQL is allowed");
const name = `medpm_documents_it_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
const testUrl = new URL(source); testUrl.pathname = `/${name}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } }); connected.client = db;
const pdf = Buffer.from("%PDF-1.4\nSynthetic integration fixture\n%%EOF\n");
const objects = new Map<string, Buffer>();
const storage: DocumentStorage = { put: vi.fn(async (key, bytes) => { objects.set(key, Buffer.from(bytes)); }), get: vi.fn(async (key) => { const bytes = objects.get(key); if (!bytes) throw Object.assign(new Error("Missing synthetic object"), { code: "NoSuchKey" }); return bytes; }), remove: vi.fn(async (key) => { objects.delete(key); }) };
let projectId: string; let actorId: string;
const input = () => ({ filename: "合成需求.pdf", mediaType: "application/pdf", bytes: pdf, uploadKey: randomUUID() });
const actor = () => ({ actorId, ip: "192.0.2.77", userAgent: "synthetic-document-integration" });
function sql(input: string) { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, input, stdio: "pipe" }); }
describe.sequential("document lifecycle with real MySQL and injected object storage", () => {
  beforeAll(async () => {
    if (!/^medpm_documents_it_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid isolated database name");
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });
  }, 60000);
  beforeEach(async () => {
    objects.clear(); vi.clearAllMocks();
    await db.$transaction(async (tx) => {
      actorId = (await tx.user.create({ data: { name: "Synthetic uploader", email: `${randomUUID()}@medpm.local`, role: "PM", status: "ACTIVE" } })).id;
      projectId = (await tx.project.create({ data: { name: "Synthetic documents", ownerId: actorId } })).id;
    });
  });
  afterAll(async () => {
    await db.$disconnect();
    try { if (/^medpm_documents_it_[a-f0-9]{32}$/.test(name)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``); }
    finally { await admin.$disconnect(); }
  });
  it("stores verified metadata, deduplicates the upload key and audits download scope", async () => {
    const file = input(); const result = await uploadDocument(projectId, file, actor(), storage);
    expect(await uploadDocument(projectId, file, actor(), storage)).toEqual({ id: result.id, duplicate: true });
    expect(storage.put).toHaveBeenCalledOnce();
    const row = await db.document.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.storageStatus).toBe("AVAILABLE"); expect(row.fileSize).toBe(pdf.length); expect(row.uploadedById).toBe(actorId);
    expect((await downloadDocument(row.id, actor(), storage)).bytes).toEqual(pdf);
    const audits = await db.auditLog.findMany({ where: { entityId: row.id } });
    expect(audits.map((log) => log.action)).toEqual(expect.arrayContaining(["DOCUMENT_UPLOAD_STARTED", "DOCUMENT_UPLOADED", "DATA_EXPORTED"]));
    expect(audits.find((log) => log.action === "DATA_EXPORTED")?.after).toMatchObject({ scope: { documentIds: [row.id], projectId, sha256: row.sha256 } });
    await expect(uploadDocument(projectId, { ...file, filename: "different.pdf" }, actor(), storage)).rejects.toMatchObject({ status: 409 });
  });
  it("persists failed upload and cleanup work, then supports repeated cleanup", async () => {
    vi.mocked(storage.put).mockRejectedValueOnce(new Error("Storage offline"));
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error("Cleanup offline"));
    await expect(uploadDocument(projectId, input(), actor(), storage)).rejects.toMatchObject({ status: 503 });
    const row = await db.document.findFirstOrThrow({ where: { projectId } });
    expect(row.storageStatus).toBe("FAILED");
    const job = await db.syncFailure.findFirstOrThrow({ where: { entityId: row.id } }); expect(job.retryCount).toBe(1);
    await expect(downloadDocument(row.id, actor(), storage)).rejects.toMatchObject({ status: 409 });
    expect(await retryDocumentCleanup(row.id, actor(), storage)).toEqual({ removed: 1 });
    expect(await db.syncFailure.count({ where: { entityId: row.id } })).toBe(0);
    expect(await retryDocumentCleanup(row.id, actor(), storage)).toEqual({ removed: 1 });
  });
  it("rejects corrupted objects before export audit", async () => {
    const result = await uploadDocument(projectId, input(), actor(), storage);
    vi.mocked(storage.get).mockResolvedValueOnce(Buffer.from("corrupted"));
    await expect(downloadDocument(result.id, actor(), storage)).rejects.toMatchObject({ status: 503 });
    expect(await db.auditLog.count({ where: { entityId: result.id, action: "DATA_EXPORTED" } })).toBe(0);
  });
  it("keeps a recoverable record if confirmation and failure audit cannot commit", async () => {
    sql("CREATE TRIGGER documents_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW BEGIN IF NEW.action IN ('DOCUMENT_UPLOADED','DOCUMENT_UPLOAD_FAILED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure'; END IF; END;");
    try { await expect(uploadDocument(projectId, input(), actor(), storage)).rejects.toThrow(); }
    finally { sql("DROP TRIGGER documents_it_fail_audit;"); }
    const row = await db.document.findFirstOrThrow({ where: { projectId } }); expect(row.storageStatus).toBe("UPLOADING");
    expect(objects.has(row.minioKey)).toBe(true);
    await expect(recoverDocument(row.id, actor(), storage)).rejects.toMatchObject({ status: 409 });
    await db.$transaction((tx) => tx.document.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - 11 * 60000) } }));
    expect(await recoverDocument(row.id, actor(), storage)).toMatchObject({ storageStatus: "AVAILABLE" });
    expect((await downloadDocument(row.id, actor(), storage)).bytes).toEqual(pdf);
  });
  it("does not issue download bytes if export audit fails", async () => {
    const result = await uploadDocument(projectId, input(), actor(), storage);
    sql("CREATE TRIGGER documents_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW BEGIN IF NEW.action = 'DATA_EXPORTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure'; END IF; END;");
    try { await expect(downloadDocument(result.id, actor(), storage)).rejects.toThrow(); }
    finally { sql("DROP TRIGGER documents_it_fail_audit;"); }
    expect(await db.auditLog.count({ where: { entityId: result.id, action: "DATA_EXPORTED" } })).toBe(0);
  });
  it("recovers an absent object as failed but leaves outages pending", async () => {
    const result = await uploadDocument(projectId, input(), actor(), storage);
    const row = await db.document.findUniqueOrThrow({ where: { id: result.id } });
    await db.$transaction((tx) => tx.document.update({ where: { id: row.id }, data: { storageStatus: "UPLOADING", updatedAt: new Date(Date.now() - 11 * 60000) } }));
    vi.mocked(storage.get).mockRejectedValueOnce(new Error("Storage offline"));
    await expect(recoverDocument(row.id, actor(), storage)).rejects.toMatchObject({ status: 503 });
    expect((await db.document.findUniqueOrThrow({ where: { id: row.id } })).storageStatus).toBe("UPLOADING");
    objects.delete(row.minioKey);
    expect(await recoverDocument(row.id, actor(), storage)).toMatchObject({ storageStatus: "FAILED" });
    expect(await db.syncFailure.count({ where: { entityId: row.id } })).toBe(1);
  });
  it("rechecks disabled uploaders and rolls back initial audit failures before object writes", async () => {
    await db.$transaction((tx) => tx.user.update({ where: { id: actorId }, data: { status: "DISABLED" } }));
    await expect(uploadDocument(projectId, input(), actor(), storage)).rejects.toMatchObject({ status: 403 });
    expect(storage.put).not.toHaveBeenCalled();
    await db.$transaction((tx) => tx.user.update({ where: { id: actorId }, data: { status: "ACTIVE" } }));
    sql("CREATE TRIGGER documents_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure';");
    try { await expect(uploadDocument(projectId, input(), actor(), storage)).rejects.toThrow(); }
    finally { sql("DROP TRIGGER documents_it_fail_audit;"); }
    expect(storage.put).not.toHaveBeenCalled(); expect(await db.document.count({ where: { projectId } })).toBe(0);
  });
  it("rolls back upload metadata without deleting document rows or audit evidence", async () => {
    const result = await uploadDocument(projectId, input(), actor(), storage);
    const count = await db.auditLog.count();
    const directory = "prisma/migrations/20261015010000_document_upload/";
    sql(readFileSync(directory + "down.sql", "utf8"));
    expect(await db.auditLog.count()).toBe(count);
    expect(await db.$queryRaw`SELECT id FROM Document WHERE id = ${result.id}`).toHaveLength(1);
    sql(readFileSync(directory + "migration.sql", "utf8"));
    expect((await db.document.findUniqueOrThrow({ where: { id: result.id } })).storageStatus).toBe("LEGACY");
  });
});
