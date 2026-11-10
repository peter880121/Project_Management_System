import { businessToday } from "@/modules/tasks/plan";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, user: null as { id: string; role: "PM" | "QA" | "MEMBER" | "ADMIN" } | null, failAudit: false }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: async () => state.user }));
import { createDeliverable, mutateDeliverable, createMeeting, syncMeeting, assetIndexStatus } from "@/modules/assets/services";
import { syncAssetSourceTick } from "@/modules/assets/source-worker";
import { buildDocumentChunksTick, syncDocumentVectorTick } from "@/modules/documents/rag-worker";
import { keywordEvidence, loadEvidenceByIds } from "@/modules/documents/rag-repositories";
import { changeTaskStatus } from "@/modules/audit/service";
import { PATCH as taskPatch } from "@/app/api/tasks/[taskId]/route";
import { POST as reviewRoute } from "@/app/api/deliverables/[deliverableId]/[operation]/route";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (state.failAudit) throw new Error("Synthetic audit outage"); return query(args); } } } });
let projectId: string, taskId: string, pmId: string, qaId: string, outsiderId: string;
const actor = () => ({ actorId: pmId, ip: "127.0.0.1", userAgent: "synthetic-assets-integration" });
async function doc() { return db.$transaction(tx => tx.document.create({ data: { projectId, filename: "synthetic-report.pdf", minioKey: `synthetic/${randomUUID()}.pdf`, mediaType: "application/pdf", storageStatus: "AVAILABLE", sha256: "a".repeat(64), fileSize: 50, uploadedById: pmId } })); }
async function draft() { return createDeliverable(projectId, { name: "Synthetic delivery report", documentId: (await doc()).id, taskId }, actor()); }
const meetingInput = () => ({ title: "Synthetic kickoff", meetingDate: new Date().toISOString(), content: "Synthetic scope and acceptance evidence", actionItems: [{ id: randomUUID(), text: "Confirm scope", checked: true }], requestKey: randomUUID(), visibleRoles: ["PM" as const] });
describe.sequential("delivery assets and index pipeline with real MySQL transactions", () => {
  beforeEach(async () => {
    state.failAudit = false;
    await db.$transaction(async tx => {
      await tx.assetSourceJob.updateMany({ data: { status: "COMPLETED", leaseUntil: null, leaseToken: null } });
      await tx.documentChunk.updateMany({ data: { vectorStatus: "SYNCED" } });
      await tx.$executeRaw`UPDATE Document SET chunkedVersion = parsedVersion WHERE parsedVersion IS NOT NULL`;
      pmId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic PM", role: "PM", status: "ACTIVE" } })).id;
      qaId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic QA", role: "QA", status: "ACTIVE" } })).id;
      outsiderId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic outsider", role: "QA", status: "ACTIVE" } })).id;
      projectId = (await tx.project.create({ data: { name: "Synthetic asset project", ownerId: pmId } })).id;
      await tx.projectMember.create({ data: { projectId, userId: qaId } });
      taskId = (await tx.task.create({ data: { projectId, title: "Synthetic review", status: "IN_PROGRESS", requiresDeliverable: true } })).id;
    }); state.user = { id: pmId, role: "PM" };
  });
  afterAll(() => db.$disconnect());
  it("migration is repeatable, preserves flags, and defaults historical/new tasks to false", async () => {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], { input: readFileSync("prisma/migrations/20261018000000_core_delivery_assets/migration.sql", "utf8"), env: process.env, stdio: "pipe" });
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).requiresDeliverable).toBe(true);
    const row = await db.$transaction(tx => tx.task.create({ data: { projectId, title: "Historical compatibility" } })); expect(row.requiresDeliverable).toBe(false);
  }, 30000);
  it("blocks DONE before password verification if no approved evidence exists", async () => {
    await expect(changeTaskStatus({ taskId, status: "DONE", completedAt: businessToday(), actualHours: 2, signaturePassword: "wrong", signatureReason: "确认任务已完成", actorId: pmId })).rejects.toMatchObject({ status: 400, message: "请先上传并审批通过的交付物" });
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("IN_PROGRESS");
    expect(await db.auditLog.count({ where: { entityId: taskId, action: "TASK_SIGNED_AND_COMPLETED" } })).toBe(0);
  });
  it("rolls back a draft and Document classification if its audit cannot commit", async () => {
    const document = await doc(); state.failAudit = true;
    await expect(createDeliverable(projectId, { name: "Synthetic", documentId: document.id }, actor())).rejects.toThrow("Synthetic audit outage");
    expect(await db.deliverable.count({ where: { projectId } })).toBe(0); expect((await db.document.findUniqueOrThrow({ where: { id: document.id } })).documentType).toBe("DOCUMENT");
  });
  it("approval atomically queues parsing, rejects replay and freezes the approved version", async () => {
    const d = await draft(); await mutateDeliverable(d.id, "submit", { rowVersion: 1, cloudProcessingConfirmed: true }, actor());
    await mutateDeliverable(d.id, "review", { rowVersion: 2, decision: "APPROVED", reviewComment: "Synthetic review" }, { actorId: qaId });
    const before = await db.deliverable.findUniqueOrThrow({ where: { id: d.id }, include: { document: true } });
    expect(before.status).toBe("APPROVED"); expect(before.document.parseStatus).toBe("QUEUED"); expect(await db.documentParseJob.count({ where: { documentId: d.documentId } })).toBe(1);
    await expect(mutateDeliverable(d.id, "edit", { rowVersion: 3, name: "Overwrite" }, actor())).rejects.toMatchObject({ status: 409 });
    const v2 = await createDeliverable(projectId, { name: d.name, taskId, documentId: (await doc()).id }, actor(), d.id);
    expect(v2.version).toBe(2); expect(v2.documentId).not.toBe(d.documentId);
    await expect(createDeliverable(projectId, { name: d.name, taskId, documentId: d.documentId }, actor(), v2.id)).rejects.toMatchObject({ status: 409 });
    expect(await db.deliverable.findUnique({ where: { id: d.id }, include: { document: true } })).toEqual(before);
  });
  it("rolls back approval, parse queue and review metadata when audit fails", async () => {
    const d = await draft(); await mutateDeliverable(d.id, "submit", { rowVersion: 1, cloudProcessingConfirmed: true }, actor()); state.failAudit = true;
    await expect(mutateDeliverable(d.id, "review", { rowVersion: 2, decision: "APPROVED" }, { actorId: qaId })).rejects.toThrow();
    expect((await db.deliverable.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("PENDING_REVIEW"); expect(await db.documentParseJob.count({ where: { documentId: d.documentId } })).toBe(0);
  });
  it("rejects cross-project review, self-review after role change, and forged task configuration", async () => {
    const d = await draft(); await mutateDeliverable(d.id, "submit", { rowVersion: 1, cloudProcessingConfirmed: true }, actor());
    state.user = { id: outsiderId, role: "QA" };
    const req = () => new Request(`http://localhost/api/deliverables/${d.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "APPROVED", rowVersion: 2 }) });
    expect((await reviewRoute(req(), { params: Promise.resolve({ deliverableId: d.id, operation: "review" }) })).status).toBe(403);
    await db.$transaction(tx => tx.user.update({ where: { id: pmId }, data: { role: "ADMIN" } })); state.user = { id: pmId, role: "ADMIN" };
    expect((await reviewRoute(req(), { params: Promise.resolve({ deliverableId: d.id, operation: "review" }) })).status).toBe(403);
    state.user = { id: qaId, role: "QA" };
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect((await taskPatch(new Request(`http://localhost/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ requiresDeliverable: false, expectedUpdatedAt: task.updatedAt.toISOString() }) }), { params: Promise.resolve({ taskId }) })).status).toBe(403);
  });
  it("meeting creation and sync roll back on audit failure", async () => {
    const input = meetingInput(); state.failAudit = true; await expect(createMeeting(projectId, input, actor())).rejects.toThrow(); expect(await db.meetingRecord.count({ where: { projectId } })).toBe(0);
    state.failAudit = false; const meeting = await createMeeting(projectId, input, actor()); state.failAudit = true; await expect(syncMeeting(meeting.id, actor())).rejects.toThrow();
    expect((await db.meetingRecord.findUniqueOrThrow({ where: { id: meeting.id } })).documentId).toBeNull(); expect(await db.assetSourceJob.count({ where: { document: { projectId } } })).toBe(0);
  });
  it("private meeting audit contains hashes, never private text or action items", async () => {
    const data = meetingInput(); const row = await createMeeting(projectId, data, actor());
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: row.id, action: "MEETING_CREATED" } });
    expect(audit.after).toMatchObject({ visibleRoles: ["PM"], actionItemCount: 1 });
    expect(JSON.stringify(audit.after)).not.toContain(data.content); expect(JSON.stringify(audit.after)).not.toContain(data.actionItems[0].text);
    expect((audit.after as { contentSha256: string }).contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("cannot attach a document while an index worker owns an active chunk lease", async () => {
    const source = await createMeeting(projectId, meetingInput(), actor()); await syncMeeting(source.id, actor()); await syncAssetSourceTick(async () => {}); await buildDocumentChunksTick();
    const row = await db.meetingRecord.findUniqueOrThrow({ where: { id: source.id } });
    const pdfDoc = await doc();
    const chunk = await db.documentChunk.findFirstOrThrow({ where: { documentId: row.documentId! } });
    await db.$transaction(async tx => {
      const parse = await tx.documentParseJob.create({ data: { documentId: pdfDoc.id, version: 1, requestedById: pmId, requestKey: randomUUID(), modelVersion: "synthetic", sourceSha256: pdfDoc.sha256!, sourceFilename: pdfDoc.filename, sourceSize: pdfDoc.fileSize!, deadlineAt: new Date(), status: "SUCCEEDED" } });
      await tx.documentChunk.create({ data: { documentId: pdfDoc.id, projectId, parseJobId: parse.id, version: 1, ordinal: 0, text: chunk.text, textSha256: chunk.textSha256, startOffset: 0, endOffset: 1, embeddingModel: chunk.embeddingModel, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000) } });
    });
    await expect(createDeliverable(projectId, { name: "Synthetic race", documentId: pdfDoc.id }, actor())).rejects.toMatchObject({ status: 409 });
    expect(await db.deliverable.count({ where: { documentId: pdfDoc.id } })).toBe(0);
  });
  it("meeting source -> chunks -> vectors retains metadata and enforces keyword/vector role boundaries", async () => {
    const meeting = await createMeeting(projectId, meetingInput(), actor()); await syncMeeting(meeting.id, actor());
    const row = await db.meetingRecord.findUniqueOrThrow({ where: { id: meeting.id } }); expect(await assetIndexStatus(row.documentId)).toBe("SYNCING");
    const put = vi.fn().mockRejectedValueOnce(new Error("Synthetic outage")).mockResolvedValue(undefined);
    await syncAssetSourceTick(put); expect(await assetIndexStatus(row.documentId)).toBe("FAILED"); expect(await db.syncFailure.count({ where: { entityId: row.documentId!, target: "ASSET_SOURCE_UPLOAD" } })).toBe(1);
    await syncMeeting(meeting.id, actor()); await syncAssetSourceTick(put); await buildDocumentChunksTick();
    expect(await keywordEvidence({ projectId, role: "MEMBER" }, "Synthetic", 5)).toHaveLength(0);
    expect((await keywordEvidence({ projectId, role: "PM" }, "Synthetic", 5)).length).toBeGreaterThan(0);
    const upsert = vi.fn(async () => {}); while (await syncDocumentVectorTick({ embed: async () => Array(1536).fill(0), upsert })) { /* drain this isolated fixture */ }
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ projectId, docId: row.documentId, documentType: "MEETING", visibleRoles: ["PM"], deliverableId: "" }));
    expect(await assetIndexStatus(row.documentId)).toBe("SYNCED");
    const ids = (await db.documentChunk.findMany({ where: { documentId: row.documentId! } })).map(c => c.id);
    expect(await loadEvidenceByIds({ projectId, role: "QA" }, ids)).toHaveLength(0); expect((await loadEvidenceByIds({ projectId, role: "PM" }, ids)).length).toBeGreaterThan(0);
  });
});
