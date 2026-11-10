import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, failAudit: "", user: null as { id: string; role: "PM" | "ADMIN" | "QA" | "MEMBER" } | null }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: async () => state.user }));
import { createComplianceCheck, currentRules } from "@/modules/projects/acceptance-check/service";
import { readDetails } from "@/modules/projects/acceptance-check/repository";
import { transitionProject } from "@/modules/projects/acceptance";
import { createTask } from "@/modules/audit/service";
import { setProjectMember } from "@/modules/projects/members";
import { POST, GET } from "@/app/api/projects/[projectId]/acceptance-check/route";
import { POST as transitionRoute } from "@/app/api/projects/[projectId]/[projectAction]/route";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (args.data.action === state.failAudit) throw new Error("Synthetic audit outage"); return query(args); } } } });
let projectId: string, pmId: string, adminId: string, qaId: string, outsiderId: string, taskId: string;
const completedAt = new Date("2026-10-19T02:00:00.123Z");
const actor = () => ({ actorId: pmId });
const transition = <T extends object>(extra: T = {} as T) => ({ expectedRowVersion: 1, requestKey: randomUUID(), comment: "", ...extra });
async function sign(time = completedAt) { return db.$transaction(tx => tx.auditLog.create({ data: { actorId: pmId, projectId, action: "TASK_SIGNED_AND_COMPLETED", entityType: "Task", entityId: taskId, after: { status: "DONE", completedAt: time.toISOString(), signatureReason: "确认任务已完成" } } })); }
async function rules() { return db.$transaction(tx => currentRules(tx, projectId)); }
async function check(userId = pmId) { return createComplianceCheck(projectId, randomUUID(), { actorId: userId }); }
describe.sequential("acceptance preflight with real MySQL JSON_TABLE and rollback", () => {
  beforeEach(async () => {
    state.failAudit = "";
    await db.$transaction(async tx => {
      const users = []; for (const role of ["PM", "ADMIN", "QA", "PM"] as const) users.push(await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: `Synthetic ${role}`, role, status: "ACTIVE" } }));
      [pmId, adminId, qaId, outsiderId] = users.map(u => u.id);
      projectId = (await tx.project.create({ data: { name: "合成结项体检项目", ownerId: pmId, status: "ACTIVE" } })).id;
      await tx.projectMember.create({ data: { projectId, userId: qaId } });
      taskId = (await tx.task.create({ data: { projectId, title: "合成最终任务", status: "DONE", completedAt, actualHours: 2 } })).id;
    }); state.user = { id: pmId, role: "PM" };
  });
  afterAll(async () => db.$disconnect());
  it("matches only the current completion round, never a historic or incomplete signature", async () => {
    await sign(new Date(completedAt.getTime() - 1000)); expect((await rules()).counts.MISSING_SIGNATURES).toBe(1);
    await db.$transaction(tx => tx.auditLog.create({ data: { actorId: pmId, projectId, action: "TASK_SIGNED_AND_COMPLETED", entityType: "Task", entityId: taskId, after: { signatureReason: "确认任务已完成" } } })); expect((await rules()).passed).toBe(false);
    await sign(); expect((await rules()).passed).toBe(true);
    await db.$transaction(tx => tx.task.update({ where: { id: taskId }, data: { completedAt: new Date(completedAt.getTime() + 1000) } })); expect((await rules()).counts.MISSING_SIGNATURES).toBe(1);
  });
  it("checks non-DONE tasks and requires available approved evidence", async () => {
    await sign(); await db.$transaction(tx => tx.task.update({ where: { id: taskId }, data: { requiresDeliverable: true, status: "IN_PROGRESS", completedAt: null, actualHours: null, completionRoundId: null, signatureEvidenceVersion: 2 } }));
    expect((await rules()).counts).toMatchObject({ UNCOMPLETED_TASKS: 1, MISSING_DELIVERABLES: 1, MISSING_SIGNATURES: 0 });
    await db.$transaction(async tx => { const doc = await tx.document.create({ data: { projectId, filename: "synthetic.pdf", mediaType: "application/pdf", minioKey: `synthetic/${randomUUID()}`, sha256: "a".repeat(64), storageStatus: "AVAILABLE" } }); const id = randomUUID(); await tx.deliverable.create({ data: { id, seriesId: id, projectId, taskId, documentId: doc.id, name: "合成规格说明书", status: "APPROVED", createdById: pmId } }); });
    expect((await rules()).counts.MISSING_DELIVERABLES).toBe(0);
    await db.$transaction(tx => tx.document.updateMany({ where: { projectId }, data: { sha256: "invalid-evidence" } }));
    const invalid = await check(adminId);
    await expect(transitionProject(projectId, "submit-acceptance", transition({ checkId: invalid.id, override: true, overrideReason: "即使由管理员说明风险，也不能将已批准但哈希损坏的合成交付物作为验收证据送审。" }), { actorId: adminId })).rejects.toMatchObject({ status: 409 });
  });
  it("uses JSON_TABLE across old meetings, counts checked and dangling actions, and pages exact details", async () => {
    await sign();
    await db.$transaction(async tx => {
      const other = await tx.project.create({ data: { name: "Other", ownerId: outsiderId } }); const foreign = await tx.task.create({ data: { projectId: other.id, title: "Foreign task" } });
      await tx.meetingRecord.create({ data: { projectId, title: "历史合成会议", content: "合成数据", meetingDate: new Date("2020-01-01"), createdById: pmId, requestKey: randomUUID(), visibleRoles: ["QA"], actionItems: [...Array.from({ length: 21 }, (_, i) => ({ id: randomUUID(), text: `Action ${i}`, checked: true })), { id: randomUUID(), text: "Foreign link", checked: false, taskId: foreign.id }, { id: randomUUID(), text: "Valid link", checked: false, taskId }] } });
    });
    expect((await rules()).counts.UNLINKED_ACTION_ITEMS).toBe(22);
    const pages = await db.$transaction(async tx => [await readDetails(tx, projectId, "UNLINKED_ACTION_ITEMS", "PM", 1), await readDetails(tx, projectId, "UNLINKED_ACTION_ITEMS", "PM", 2)]);
    expect(pages[0]).toHaveLength(20); expect(pages[1]).toHaveLength(2); expect(pages.flat().every(row => !row.label.includes("历史合成会议"))).toBe(true);
    const saved = await check();
    const response = await GET(new Request(`http://localhost/?checkId=${saved.id}&rule=UNLINKED_ACTION_ITEMS&page=2`), { params: Promise.resolve({ projectId }) });
    expect(response.status).toBe(200); expect((await response.json()).details).toEqual(pages[1]);
  });
  it("returns the required JSON without model invocation and records an immutable audit on pass", async () => {
    await sign(); const res = await POST(new Request(`http://localhost/api/projects/${projectId}/acceptance-check`, { method: "POST", body: "{}" }), { params: Promise.resolve({ projectId }) });
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ passed: true, message: "合规检查通过，可提交验收" });
    const id = res.headers.get("x-check-id")!; expect(await db.auditLog.count({ where: { entityId: id, action: "PROJECT_COMPLIANCE_CHECKED" } })).toBe(1);
    await expect(db.$executeRaw`UPDATE ProjectComplianceCheck SET passed=false WHERE id=${id}`).rejects.toThrow("ER_COMPLIANCE_CHECK_IMMUTABLE");
    await expect(db.$executeRaw`DELETE FROM ProjectComplianceCheck WHERE id=${id}`).rejects.toThrow("ER_COMPLIANCE_CHECK_IMMUTABLE");
  });
  it("can remediate finalized meeting actions without rewriting finalized content", async () => {
    await sign(); const itemId = randomUUID();
    const meeting = await db.$transaction(tx => tx.meetingRecord.create({ data: { projectId, title: "定稿合成会议", content: "不可改写的合成会议正文", meetingDate: completedAt, actionItems: [{ id: itemId, text: "落实验收复核", checked: true }], visibleRoles: ["PM"], createdById: pmId, requestKey: randomUUID() } }));
    expect((await rules()).counts.UNLINKED_ACTION_ITEMS).toBe(1);
    const task = await createTask({ phase: "项目启动", estimateHours: 4, dueDate: null, projectId, actorId: pmId, title: "落实验收复核", meetingSource: { meetingId: meeting.id, actionItemId: itemId, expectedVersion: 1, visibilityExpansionConfirmed: true } });
    const after = await db.meetingRecord.findUniqueOrThrow({ where: { id: meeting.id } }); expect(after.status).toBe("FINALIZED"); expect(after.content).toBe(meeting.content); expect(after.actionItems).toMatchObject([{ id: itemId, text: "落实验收复核", checked: true, taskId: task.id }]); expect((await rules()).counts.UNLINKED_ACTION_ITEMS).toBe(0);
  });
  it("does not permit an empty project to bypass the hard submission boundary", async () => {
    await db.$transaction(tx => tx.task.delete({ where: { id: taskId } })); const empty = await check(adminId); expect(empty.passed).toBe(false);
    await expect(transitionProject(projectId, "submit-acceptance", transition({ checkId: empty.id, override: true, overrideReason: "该合成项目尚未建立任务，尽管由管理员提出说明，也不能通过空项目验收。" }), { actorId: adminId })).rejects.toMatchObject({ status: 400 }); expect(await db.projectAcceptance.count({ where: { projectId } })).toBe(0);
  });
  it("audits failed checks and rolls the complete check back if audit SQL fails", async () => {
    const failed = await check(); expect(failed.passed).toBe(false); expect(await db.auditLog.count({ where: { entityId: failed.id } })).toBe(1);
    state.failAudit = "PROJECT_COMPLIANCE_CHECKED"; await expect(check()).rejects.toThrow("Synthetic audit outage"); expect(await db.projectComplianceCheck.count({ where: { projectId } })).toBe(1);
  });
  it("detects changed task data even if state is later restored; submit returns CHECK_STALE", async () => {
    await sign(); const before = await check();
    await db.$transaction(tx => tx.task.update({ where: { id: taskId }, data: { description: "Changed synthetic task" } }));
    const response = await transitionRoute(new Request(`http://localhost/api/projects/${projectId}/submit-acceptance`, { method: "POST", body: JSON.stringify(transition({ checkId: before.id })) }), { params: Promise.resolve({ projectId, projectAction: "submit-acceptance" }) });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CHECK_STALE" }); expect(await db.projectAcceptance.count({ where: { projectId } })).toBe(0);
  });
  it("does not trust the UI: missing signatures block normal submit even without a check ID", async () => {
    await expect(transitionProject(projectId, "submit-acceptance", transition(), actor())).rejects.toMatchObject({ status: 400 });
    expect(await db.projectAcceptance.count({ where: { projectId } })).toBe(0);
  });
  it("requires an ADMIN project grant for PM override and never lets it pass QA or archive", async () => {
    const failed = await check(); const body = transition({ checkId: failed.id, override: true, overrideReason: "合成项目需要先送审确认整改范围，由负责人补齐签名后重新发起正式验收。" });
    await expect(transitionProject(projectId, "submit-acceptance", body, actor())).rejects.toMatchObject({ status: 403 });
    await expect(setProjectMember(projectId, { userId: pmId, active: true, expectedVersion: 0, canOverrideAcceptance: true }, actor())).rejects.toMatchObject({ status: 403 });
    await setProjectMember(projectId, { userId: pmId, active: true, expectedVersion: 0, canOverrideAcceptance: true }, { actorId: adminId });
    const submitted = await transitionProject(projectId, "submit-acceptance", body, actor()); const acceptance = await db.projectAcceptance.findUniqueOrThrow({ where: { id: submitted.currentAcceptanceId! } });
    expect(acceptance.overrideGapCount).toBe(1); expect(acceptance.overrideCheckId).toBe(failed.id); expect(acceptance.overrideReason).toBe(body.overrideReason);
    await expect(transitionProject(projectId, "qa-approve", transition({ expectedRowVersion: 2, acceptanceId: acceptance.id }), { actorId: qaId })).rejects.toMatchObject({ status: 400 });
    await expect(transitionProject(projectId, "archive", transition({ expectedRowVersion: 2, acceptanceId: acceptance.id }), { actorId: adminId })).rejects.toMatchObject({ status: 400 });
    await expect(db.$executeRaw`UPDATE ProjectAcceptance SET overrideGapCount=0 WHERE id=${acceptance.id}`).rejects.toThrow("ER_ACCEPTANCE_IMMUTABLE");
  });
  it("rechecks a revoked override grant and rolls a failed override audit back atomically", async () => {
    const failed = await check(); const grant = await setProjectMember(projectId, { userId: pmId, active: true, expectedVersion: 0, canOverrideAcceptance: true }, { actorId: adminId });
    await setProjectMember(projectId, { userId: pmId, active: true, expectedVersion: grant.version, canOverrideAcceptance: false }, { actorId: adminId });
    const body = transition({ checkId: failed.id, override: true, overrideReason: "合成项目说明整改风险和责任人，由 QA 先行确认整改范围后再重新送审。" });
    await expect(transitionProject(projectId, "submit-acceptance", body, actor())).rejects.toMatchObject({ status: 403 });
    const adminCheck = await check(adminId); state.failAudit = "PROJECT_ACCEPTANCE_OVERRIDE_SUBMITTED";
    await expect(transitionProject(projectId, "submit-acceptance", { ...body, checkId: adminCheck.id }, { actorId: adminId })).rejects.toThrow("Synthetic audit outage");
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("ACTIVE"); expect(await db.projectAcceptance.count({ where: { projectId } })).toBe(0);
  });
  it("rejects cross-project checks, request-ID collisions, forbidden roles and cross-origin POST", async () => {
    await sign(); const id = randomUUID(); const other = await db.$transaction(tx => tx.project.create({ data: { name: "Private project", ownerId: outsiderId } }));
    await db.$transaction(tx => tx.aiSuggestion.create({ data: { id, projectId: other.id, type: "WBS", input: {}, output: { secret: "Synthetic private" } } }));
    await expect(createComplianceCheck(projectId, id, actor())).rejects.toMatchObject({ status: 409 });
    const scope = { params: Promise.resolve({ projectId }) }; const req = () => new Request(`http://localhost/api/projects/${projectId}/acceptance-check`, { method: "POST", body: "{}" });
    state.user = { id: outsiderId, role: "PM" }; expect((await POST(req(), scope)).status).toBe(403);
    state.user = { id: qaId, role: "QA" }; expect((await POST(req(), scope)).status).toBe(403);
    state.user = { id: pmId, role: "PM" }; const cross = new Request(req(), { headers: { origin: "https://untrusted.invalid" } }); expect((await POST(cross, scope)).status).toBe(403);
    const own = await check(); state.user = { id: outsiderId, role: "PM" }; expect((await GET(new Request(`http://localhost/?checkId=${own.id}`), scope)).status).toBe(403);
  });
});
