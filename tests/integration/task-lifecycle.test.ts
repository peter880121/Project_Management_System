import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, failAudit: false }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
import { assignTask, changeTaskStatus } from "@/modules/audit/service";
import { hashPassword } from "@/modules/auth/password";
import { businessToday } from "@/modules/tasks/plan";
import { currentRules } from "@/modules/projects/acceptance-check/service";
import { transitionProject, acceptanceEvidence } from "@/modules/projects/acceptance";
import { getProjectPlanning, updateTaskSchedule } from "@/modules/planning/services";
import { dashboardStats } from "@/modules/dashboard/service";
import { scanProjectRisks } from "@/modules/ai/risk/service";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (state.failAudit) throw new Error("Synthetic task audit outage"); return query(args); } } } });
let pmId: string, adminId: string, memberId: string, projectId: string, taskId: string;
const password = randomUUID(); const reason = "合成取消：需求范围已由客户正式移除，保留历史交付证据。";
const cancel = (actorId = pmId, expectedRowVersion = 1) => changeTaskStatus({ taskId, status: "CANCELLED", cancelReason: reason, expectedRowVersion, actorId });
async function signed() { return changeTaskStatus({ taskId, status: "DONE", actualHours: 2, completedAt: businessToday(), signaturePassword: password, signatureReason: "确认任务已完成", expectedRowVersion: 1, actorId: pmId }); }
describe.sequential("task cancellation and signature-round isolation in real MySQL", () => {
  beforeAll(async () => {
    if (!/^medpm_test_ia_/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) throw new Error("Run in scripts/test-project-ia.mjs isolated DB");
    const passwordHash = await hashPassword(password);
    [pmId, adminId, memberId] = await db.$transaction(async tx => { const ids: string[] = []; for (const role of ["PM", "ADMIN", "MEMBER"] as const) ids.push((await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: `Synthetic task ${role}`, role, status: "ACTIVE", passwordHash } })).id); return ids; });
  });
  beforeEach(async () => {
    state.failAudit = false;
    await db.$transaction(async tx => {
      projectId = (await tx.project.create({ data: { name: "Synthetic task lifecycle", ownerId: pmId, status: "ACTIVE" } })).id;
      await tx.projectMember.create({ data: { projectId, userId: memberId } });
      taskId = (await tx.task.create({ data: { projectId, title: "Synthetic cancellable task", status: "IN_PROGRESS", assigneeId: memberId, plannedStartDate: new Date("2026-10-12T00:00:00Z"), dueDate: new Date("2026-10-13T00:00:00Z"), estimateHours: 8 } })).id;
    });
  });
  afterAll(() => db.$disconnect());
  it.each(["PM", "ADMIN"])("allows %s to cancel with immutable reason and dedicated audit", async role => {
    const result = await cancel(role === "PM" ? pmId : adminId);
    expect(result).toMatchObject({ status: "CANCELLED", cancelReason: reason, rowVersion: 2 }); expect(result.cancelledAt).not.toBeNull();
    expect((await db.auditLog.findFirstOrThrow({ where: { entityId: taskId, action: "TASK_CANCELLED" } })).after).toMatchObject({ cancelReason: reason, status: "CANCELLED" });
  });
  it("rejects empty reasons, MEMBER cancellation and stale versions", async () => {
    await expect(changeTaskStatus({ taskId, status: "CANCELLED", cancelReason: " ", expectedRowVersion: 1, actorId: pmId })).rejects.toMatchObject({ status: 400 });
    await expect(cancel(memberId)).rejects.toMatchObject({ status: 403 }); await expect(cancel(pmId, 99)).rejects.toMatchObject({ status: 409 });
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("IN_PROGRESS");
  });
  it("rechecks project membership in the transaction and denies an unrelated PM", async () => {
    const outsider = await db.$transaction(tx => tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic unrelated PM", role: "PM", status: "ACTIVE" } }));
    await expect(cancel(outsider.id)).rejects.toMatchObject({ status: 403 }); expect(await db.auditLog.count({ where: { entityId: taskId } })).toBe(0);
  });
  it("serializes cancellation against reassignment using the observed task version", async () => {
    const results = await Promise.allSettled([cancel(), assignTask({ taskId, assigneeId: null, actorId: pmId, expectedRowVersion: 1 })]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.rowVersion).toBe(2); if (task.status === "CANCELLED") expect(task.assigneeId).toBe(memberId); else expect(task.assigneeId).toBeNull();
    expect(await db.auditLog.count({ where: { entityId: taskId, action: { in: ["TASK_CANCELLED", "TASK_ASSIGNED"] } } })).toBe(1);
  });
  it("terminal cancellation blocks every status, assignment, schedule, SQL update and deletion", async () => {
    await cancel();
    for (const status of ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] as const) await expect(changeTaskStatus({ taskId, status, expectedRowVersion: 2, actorId: pmId })).rejects.toMatchObject({ status: 409 });
    await expect(assignTask({ taskId, assigneeId: null, actorId: pmId })).rejects.toMatchObject({ status: 409 });
    await expect(updateTaskSchedule(taskId, { plannedStartDate: null, dueDate: null, estimateHours: 2, dependencyIds: [], expectedVersion: 0 }, { actorId: pmId })).rejects.toMatchObject({ status: 409 });
    await expect(db.$executeRaw`UPDATE Task SET title='tampered' WHERE id=${taskId}`).rejects.toThrow("ER_TASK_CANCELLED");
    await expect(db.$executeRaw`DELETE FROM Task WHERE id=${taskId}`).rejects.toThrow("ER_TASK_CANCELLED");
  });
  it.each(["TODO", "IN_PROGRESS"] as const)("reopen to %s clears all actuals and the round, and a second same-day signature gets a new UUID", async status => {
    const first = await signed();
    const reopened = await changeTaskStatus({ taskId, status, expectedRowVersion: first.rowVersion, actorId: pmId });
    expect(reopened).toMatchObject({ completedAt: null, actualHours: null, completionRoundId: null, signatureEvidenceVersion: 2 });
    expect(await db.auditLog.count({ where: { entityId: taskId, action: "TASK_REOPENED" } })).toBe(1);
    const ready = status === "TODO" ? await changeTaskStatus({ taskId, status: "IN_PROGRESS", expectedRowVersion: reopened.rowVersion, actorId: pmId }) : reopened;
    await expect(changeTaskStatus({ taskId, status: "DONE", actualHours: 2, completedAt: businessToday(), signaturePassword: password, signatureReason: "确认任务已完成", actorId: pmId })).rejects.toMatchObject({ status: 409 });
    const second = await changeTaskStatus({ taskId, status: "DONE", expectedRowVersion: ready.rowVersion, expectedCompletionRoundId: null, actualHours: 2, completedAt: businessToday(), signaturePassword: password, signatureReason: "确认任务已完成", actorId: pmId });
    expect(second.completionRoundId).not.toBe(first.completionRoundId); expect(await db.auditLog.count({ where: { entityId: taskId, action: "TASK_SIGNED_AND_COMPLETED" } })).toBe(2);
  });
  it("strict NULL rounds never take the legacy timestamp fallback, including a same-date SQL corruption", async () => {
    const first = await signed(); await changeTaskStatus({ taskId, status: "IN_PROGRESS", expectedRowVersion: first.rowVersion, actorId: pmId });
    await db.$executeRaw`UPDATE Task SET status='DONE',actualHours=2,completedAt=${first.completedAt} WHERE id=${taskId}`;
    expect((await db.$transaction(tx => currentRules(tx, projectId))).counts.MISSING_SIGNATURES).toBe(1);
    await expect(db.$executeRaw`UPDATE Task SET signatureEvidenceVersion=1 WHERE id=${taskId}`).rejects.toThrow("ER_TASK_REOPEN_CLEANUP");
  });
  it.each(["cancel", "reopen"])("rolls back %s and evidence atomically when audit storage fails", async action => {
    const before = action === "reopen" ? await signed() : await db.task.findUniqueOrThrow({ where: { id: taskId } }); state.failAudit = true;
    await expect(action === "cancel" ? cancel() : changeTaskStatus({ taskId, status: "TODO", expectedRowVersion: before.rowVersion, actorId: pmId })).rejects.toThrow("Synthetic task audit outage");
    const after = await db.task.findUniqueOrThrow({ where: { id: taskId } }); expect(after.status).toBe(before.status); expect(after.completedAt).toEqual(before.completedAt); expect(after.rowVersion).toBe(before.rowVersion);
  });
  it("removes cancelled work from PMO overdue/workload, capacity and risk scans without erasing Gantt data", async () => {
    const before = await getProjectPlanning(projectId, new Date("2026-10-12T00:00:00Z"));
    await cancel();
    const stats = await dashboardStats(pmId, { projectId, healthPage: 1, loadPage: 1 }, new Date("2026-10-20T00:00:00Z"));
    expect(stats.metrics.overdueTasks).toBe(0); expect(stats.workload.rows).toHaveLength(0); expect(stats.health.rows[0]).toMatchObject({ total: 0, done: 0, progress: null });
    const plan = await getProjectPlanning(projectId, new Date("2026-10-12T00:00:00Z")); expect(plan.tasks[0].status).toBe("CANCELLED"); expect(plan.loads.every(row => !row.taskIds.includes(taskId))).toBe(true); expect(plan.loads.find(row => row.userId === memberId)?.taskCount).toBe((before.loads.find(row => row.userId === memberId)?.taskCount ?? 0) - 1);
    const risk = await db.$transaction(tx => scanProjectRisks(tx, { projectId, actorId: pmId, now: new Date("2026-10-20T00:00:00Z") })); expect(risk.data).toHaveLength(0);
    expect((await db.$transaction(tx => currentRules(tx, projectId))).counts.EMPTY_PROJECT).toBe(1);
  });
  it("records dependent warnings and blocks starting or completing a task whose prerequisite was cancelled", async () => {
    const dependent = await db.$transaction(async tx => { const task = await tx.task.create({ data: { projectId, title: "Synthetic dependent", status: "TODO" } }); await tx.taskDependency.create({ data: { taskId: task.id, dependsOnTaskId: taskId } }); return task; });
    await cancel(); expect(await db.auditLog.count({ where: { entityId: dependent.id, action: "TASK_DEPENDENCY_INVALIDATED" } })).toBe(1);
    await expect(changeTaskStatus({ taskId: dependent.id, status: "IN_PROGRESS", actorId: pmId })).rejects.toThrow("前置任务已被取消");
  });
  it("acceptance ignores cancelled scope but retains cancellation audit IDs in versioned evidence", async () => {
    await cancel();
    await db.$transaction(async tx => {
      const completedAt = new Date("2026-10-19T00:00:00Z"); const task = await tx.task.create({ data: { projectId, title: "Synthetic retained delivery", status: "DONE", completedAt, actualHours: 2 } });
      await tx.auditLog.create({ data: { actorId: pmId, projectId, entityType: "Task", entityId: task.id, action: "TASK_SIGNED_AND_COMPLETED", after: { status: "DONE", completedAt: completedAt.toISOString(), signatureReason: "确认任务已完成" } } });
    });
    const rules = await db.$transaction(tx => currentRules(tx, projectId)); expect(rules.passed).toBe(true);
    const evidence = await db.$transaction(tx => acceptanceEvidence(tx, projectId, 4)); expect(evidence.tasks).toHaveLength(2); expect(evidence.cancellationAuditIds).toHaveLength(1);
    expect((await transitionProject(projectId, "submit-acceptance", { expectedRowVersion: 1, requestKey: randomUUID(), comment: "" }, { actorId: pmId })).status).toBe("PENDING_ACCEPTANCE");
  });
});
