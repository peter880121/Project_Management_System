import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { syntheticDocx } from "../fixtures/docx";
const state = vi.hoisted(() => ({ db: undefined as unknown, failAttachmentAudit: false, user: null as { id: string; role: "PM" | "QA" | "MEMBER" } | null }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: async () => state.user }));
import { uploadDocument, downloadDocument, recoverDocument } from "@/modules/documents/services";
import { listDocuments } from "@/modules/documents/repositories";
import { createMeeting, createDeliverable } from "@/modules/assets/services";
import { requestDocumentParse } from "@/modules/documents/parse-service";
import { runParseWorkerTick } from "@/modules/documents/parse-worker";
import { buildDocumentChunksTick, syncDocumentVectorTick } from "@/modules/documents/rag-worker";
import { changeProjectLifecycle } from "@/modules/projects/lifecycle";
import { GET, POST } from "@/app/api/projects/[projectId]/meetings/[meetingId]/attachments/route";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (state.failAttachmentAudit && args.data.action === "MEETING_ATTACHMENT_ADDED") throw new Error("Synthetic attachment audit failure"); return query(args); } } } });
const objects = new Map<string, Buffer>();
const storage = { put: vi.fn(async (key: string, bytes: Buffer) => { objects.set(key, bytes); }), get: vi.fn(async (key: string) => { const bytes = objects.get(key); if (!bytes) throw new Error("Synthetic missing object"); return bytes; }), remove: vi.fn(async (key: string) => { objects.delete(key); }) };
let pm: string, qa: string, member: string, outsider: string, projectId: string, meetingId: string;
const actor = () => ({ actorId: pm });
const context = () => ({ params: Promise.resolve({ projectId, meetingId }) });
const input = (extension = "md") => ({ meetingId, filename: `synthetic.${extension}`, mediaType: "", uploadKey: randomUUID(), bytes: extension === "docx" ? syntheticDocx() : extension === "pdf" ? Buffer.from("%PDF-1.4\nsynthetic") : Buffer.from("# Synthetic meeting evidence") });
async function meeting(visibleRoles: ("PM" | "QA" | "ADMIN" | "MEMBER")[] = ["PM"], status: "DRAFT" | "FINALIZED" = "FINALIZED") {
  return createMeeting(projectId, { title: "Synthetic attachment meeting", content: "Synthetic meeting body", meetingDate: new Date().toISOString(), requestKey: randomUUID(), visibleRoles, status, actionItems: [] }, actor());
}
describe.sequential("meeting attachments with real MySQL transactions", () => {
  beforeAll(async () => {
    if (!/^medpm_test_ia_/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) throw new Error("Requires isolated test database");
    [pm, qa, member, outsider] = await db.$transaction(async tx => { const ids: string[] = []; for (const role of ["PM", "QA", "MEMBER", "PM"] as const) ids.push((await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: `Synthetic ${role}`, role, status: "ACTIVE" } })).id); return ids; });
    // Rollback is only exercised before any attachment evidence exists, in this isolated database.
    if (!await db.document.count({ where: { meetingAttachmentId: { not: null } } }) && !await db.auditLog.count({ where: { action: "MEETING_ATTACHMENT_ADDED" } })) {
      execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/migrations/20261026000000_meeting_attachments/rollback.sql", "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true });
      execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/migrations/20261026000000_meeting_attachments/migration.sql", "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true });
    }
    // Replaying the additive migration must preserve existing schema and evidence.
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/migrations/20261026000000_meeting_attachments/migration.sql", "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true });
  });
  beforeEach(async () => {
    state.failAttachmentAudit = false; vi.clearAllMocks(); state.user = { id: pm, role: "PM" };
    await db.$transaction(async tx => { projectId = (await tx.project.create({ data: { name: "Synthetic meeting attachment project", status: "ACTIVE", ownerId: pm } })).id; await tx.projectMember.createMany({ data: [qa, member].map(userId => ({ projectId, userId })) }); });
    meetingId = (await meeting()).id;
  });
  afterAll(() => db.$disconnect());
  it.each(["pdf", "docx", "txt", "text", "md"])("stores %s privately, round-trips exact bytes and audits once", async extension => {
    const data = input(extension); const uploaded = await uploadDocument(projectId, data, actor(), storage);
    const row = await db.document.findUniqueOrThrow({ where: { id: uploaded.id } }); expect(row).toMatchObject({ meetingAttachmentId: meetingId, documentType: "MEETING_ATTACHMENT", visibleRoles: ["PM"], storageStatus: "AVAILABLE" });
    expect((await downloadDocument(row.id, actor(), storage)).bytes).toEqual(data.bytes);
    expect((await db.meetingRecord.findUniqueOrThrow({ where: { id: meetingId } })).documentId).toBeNull();
    expect(await listDocuments(projectId, 1, "ADMIN")).toHaveLength(0);
    expect(await uploadDocument(projectId, data, actor(), storage)).toEqual({ id: uploaded.id, duplicate: true });
    expect(await db.auditLog.count({ where: { entityId: meetingId, action: "MEETING_ATTACHMENT_ADDED" } })).toBe(1);
    await expect(downloadDocument(row.id, { actorId: qa }, storage)).rejects.toMatchObject({ status: 403 });
    await expect(createDeliverable(projectId, { name: "Do not widen visibility", documentId: row.id }, actor())).rejects.toMatchObject({ status: 400 });
  });
  it("denies cross-project/role uploads and cross-meeting key reuse before storage", async () => {
    const data = input(); await uploadDocument(projectId, data, actor(), storage); const calls = storage.put.mock.calls.length;
    for (const actorId of [qa, member, outsider]) await expect(uploadDocument(projectId, input(), { actorId }, storage)).rejects.toMatchObject({ status: 403 });
    const second = await meeting(); await expect(uploadDocument(projectId, { ...data, meetingId: second.id }, actor(), storage)).rejects.toMatchObject({ status: 409 });
    expect(storage.put).toHaveBeenCalledTimes(calls);
    state.user = { id: outsider, role: "PM" }; expect((await GET(new Request("http://localhost/api?page=1"), context())).status).toBe(403);
  });
  it("hides draft attachments from readers and blocks parsing until finalized", async () => {
    meetingId = (await meeting(["PM", "QA", "MEMBER", "ADMIN"], "DRAFT")).id;
    const uploaded = await uploadDocument(projectId, input(), actor(), storage);
    await expect(requestDocumentParse(uploaded.id, { requestKey: randomUUID(), expectedVersion: 0 }, actor())).rejects.toMatchObject({ status: 409 });
    for (const [id, role] of [[qa, "QA"], [member, "MEMBER"]] as const) { state.user = { id, role }; expect((await GET(new Request("http://localhost/api"), context())).status).toBe(403); await expect(downloadDocument(uploaded.id, { actorId: id }, storage)).rejects.toMatchObject({ status: 403 }); }
    expect(await db.documentParseJob.count({ where: { documentId: uploaded.id } })).toBe(0);
  });
  it("allows public finalized attachments and exposes only public metadata", async () => {
    meetingId = (await meeting(["PM", "QA", "MEMBER", "ADMIN"])).id; const uploaded = await uploadDocument(projectId, input(), actor(), storage);
    state.user = { id: qa, role: "QA" }; const response = await GET(new Request("http://localhost/api"), context()); expect(response.status).toBe(200); const rows = (await response.json()).data; expect(rows).toHaveLength(1); expect(rows[0].minioKey).toBeUndefined(); expect(rows[0].uploadKey).toBeUndefined(); expect((await downloadDocument(uploaded.id, { actorId: qa }, storage)).bytes).toEqual(input().bytes);
    expect((await POST(new Request("http://localhost/api", { method: "POST" }), context())).status).toBe(403);
  });
  it("parses a finalized attachment and indexes it with its private meeting metadata", async () => {
    const uploaded = await uploadDocument(projectId, input(), actor(), storage);
    await requestDocumentParse(uploaded.id, { requestKey: randomUUID(), expectedVersion: 0 }, actor());
    const mineru = { reserve: vi.fn(), upload: vi.fn(), poll: vi.fn(), result: vi.fn() };
    await runParseWorkerTick({ storage, mineru }); expect(mineru.reserve).not.toHaveBeenCalled(); for (let i = 0; i < 30 && await buildDocumentChunksTick(); i++);
    const upsert = vi.fn(async () => {}); for (let i = 0; i < 30 && await syncDocumentVectorTick({ embed: async () => Array(1536).fill(0.1), upsert }); i++);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ docId: uploaded.id, projectId, documentType: "MEETING_ATTACHMENT", visibleRoles: ["PM"] }));
    expect(await db.documentChunk.count({ where: { documentId: uploaded.id, vectorStatus: "SYNCED" } })).toBeGreaterThan(0);
  });
  it("rolls back availability and attachment audit on audit failure, then cleans the object", async () => {
    state.failAttachmentAudit = true; await expect(uploadDocument(projectId, input(), actor(), storage)).rejects.toMatchObject({ status: 503 });
    const row = await db.document.findFirstOrThrow({ where: { meetingAttachmentId: meetingId } }); expect(row.storageStatus).toBe("FAILED"); expect(objects.has(row.minioKey)).toBe(false); expect(await db.auditLog.count({ where: { entityId: meetingId, action: "MEETING_ATTACHMENT_ADDED" } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: row.id, action: "DOCUMENT_UPLOADED" } })).toBe(0);
  });
  it("recovers interrupted uploads with a meeting attachment audit", async () => {
    const uploaded = await uploadDocument(projectId, input(), actor(), storage); await db.$transaction(tx => tx.document.update({ where: { id: uploaded.id }, data: { storageStatus: "UPLOADING", updatedAt: new Date(Date.now() - 11 * 60000) } }));
    expect(await recoverDocument(uploaded.id, actor(), storage)).toMatchObject({ storageStatus: "AVAILABLE" }); expect(await db.auditLog.findFirst({ where: { entityId: meetingId, action: "MEETING_ATTACHMENT_ADDED" }, orderBy: { createdAt: "desc" } })).toMatchObject({ after: { recovered: true, documentId: uploaded.id } });
  });
  it("serializes concurrent uploads at the 20-file boundary", async () => {
    await db.$transaction(tx => tx.document.createMany({ data: Array.from({ length: 19 }, () => ({ projectId, meetingAttachmentId: meetingId, filename: "synthetic.txt", mediaType: "text/plain", minioKey: `synthetic/${randomUUID()}`, uploadedById: pm, storageStatus: "AVAILABLE" as const })) }));
    const results = await Promise.allSettled([uploadDocument(projectId, input(), actor(), storage), uploadDocument(projectId, input(), actor(), storage)]); expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(await db.document.count({ where: { meetingAttachmentId: meetingId } })).toBe(20);
  });
  it("uses the shared freeze guard for upload and database writes", async () => {
    const uploaded = await uploadDocument(projectId, input(), actor(), storage);
    await changeProjectLifecycle(projectId, "pause", { expectedRowVersion: 1, requestKey: randomUUID(), reason: "Synthetic project pause for attachment freeze test" }, actor());
    await expect(uploadDocument(projectId, input(), actor(), storage)).rejects.toMatchObject({ projectStatus: "ON_HOLD" });
    expect((await POST(new Request("http://localhost/api", { method: "POST" }), context())).status).toBe(403);
    await expect(db.$executeRaw`UPDATE Document SET filename='tampered.md' WHERE id=${uploaded.id}`).rejects.toThrow("ER_PROJECT_FROZEN");
    expect((await downloadDocument(uploaded.id, actor(), storage)).bytes).toEqual(input().bytes);
  });
  it("refuses rollback after attachment evidence exists", () => {
    expect(() => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/migrations/20261026000000_meeting_attachments/rollback.sql", "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true })).toThrow();
  });
});
