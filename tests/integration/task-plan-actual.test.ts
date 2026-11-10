import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: null as { id: string; role: "PM" } | null, failAudit: false }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: async () => state.actor }));
import { POST } from "@/app/api/projects/[projectId]/tasks/route";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { createTask, changeTaskStatus, acceptWbsSuggestion } from "@/modules/audit/service";
import { createProject } from "@/modules/projects/services";
import { updateTaskSchedule } from "@/modules/planning/services";
import { readCounts } from "@/modules/projects/acceptance-check/repository";
import { unsignedTaskCount } from "@/modules/dashboard/repositories";
import { acceptanceEvidence } from "@/modules/projects/acceptance";
import { businessToday, calendarDateTime } from "@/modules/tasks/plan";
import { hashPassword } from "@/modules/auth/password";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (state.failAudit) throw new Error("Synthetic audit outage"); return query(args); } } } });
let actorId: string, projectId: string;
const password = `Synthetic-${randomUUID()}`;
const plan = { phase: "验证与测试", estimateHours: 8, dueDate: "2026-12-01", plannedStartDate: "2026-11-27" };
const actualDate = () => { const date = calendarDateTime(businessToday()); date.setUTCDate(date.getUTCDate() - 2); return date.toISOString().slice(0, 10); };
const actual = () => ({ expectedRowVersion: 2, status: "DONE" as const, completedAt: actualDate(), actualHours: 10.25, signaturePassword: password, signatureReason: "确认测试通过", actorId });
const create = (extra = {}) => createTask({ ...plan, title: "合成计划实际验证任务", projectId, actorId, ...extra });
describe.sequential("real MySQL task plan, actuals and signature rounds", () => {
  beforeAll(async () => { const passwordHash = await hashPassword(password); actorId = (await db.$transaction(tx => tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic plan PM", role: "PM", status: "ACTIVE", passwordHash } }))).id; state.actor = { id: actorId, role: "PM" }; });
  beforeEach(async () => { state.failAudit = false; projectId = (await db.$transaction(tx => tx.project.create({ data: { name: "合成双轨验证项目", ownerId: actorId, status: "ACTIVE" } }))).id; });
  afterAll(async () => db.$disconnect());
  it("validates HTTP creation strictly and lets MySQL mark unresolved dates pending", async () => {
    const context = { params: Promise.resolve({ projectId }) };
    const post = (body: unknown) => POST(new Request(`http://localhost/api/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify(body) }), context);
    for (const body of [{ title: "missing" }, { title: "bad", ...plan, estimateHours: 0 }, { title: "bad", ...plan, createdAt: new Date().toISOString() }, { title: "bad", ...plan, phase: "x\ny" }]) expect((await post(body)).status).toBe(400);
    expect(await db.task.count({ where: { projectId } })).toBe(0);
    const response = await post({ title: "未指定开始日期", ...plan, plannedStartDate: null }); expect(response.status).toBe(201);
    const task = (await response.json()).data; expect(task.planningStatus).toBe("UNSCHEDULED"); expect(task.createdAt).toBeTruthy(); expect(task.actualHours).toBeNull(); expect(task.completedAt).toBeNull();
    await updateTaskSchedule(task.id, { expectedVersion: 0, plannedStartDate: plan.plannedStartDate, dueDate: plan.dueDate, estimateHours: 8, dependencyIds: [] }, { actorId });
    const changed = await db.task.findUniqueOrThrow({ where: { id: task.id } }); expect(changed.planningStatus).toBe("SCHEDULED"); expect(changed.dueDate?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    await expect(db.$transaction(tx => tx.task.update({ where: { id: task.id }, data: { planningStatus: "UNSCHEDULED" } }))).rejects.toThrow();
  });
  it("WBS adoption uses strict effort, inherits phase and stays explicitly pending", async () => {
    const source = await create();
    const suggestion = await db.$transaction(tx => tx.aiSuggestion.create({ data: { projectId, type: "WBS", input: { sourceTaskId: source.id }, output: { title: "合成子任务", description: "待人工采纳", estimateHours: 3.5, suggestedRole: "MEMBER", dependencyIds: [], dependencyTitles: [] } } }));
    const result = await acceptWbsSuggestion({ suggestionId: suggestion.id, actorId }); expect(result.task.planningStatus).toBe("UNSCHEDULED"); expect(result.task.description).toContain("所属阶段：验证与测试"); expect(Number(result.task.estimateHours)).toBe(3.5); expect(result.task.dueDate).toBeNull();
    const bad = await db.$transaction(tx => tx.aiSuggestion.create({ data: { projectId, type: "WBS", input: {}, output: { ...(suggestion.output as object), estimateHours: 0.001 } } }));
    await expect(acceptWbsSuggestion({ suggestionId: bad.id, actorId })).rejects.toThrow(); expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe("PENDING"); expect(await db.task.count({ where: { projectId } })).toBe(2);
    const explicit = await db.$transaction(tx => tx.aiSuggestion.create({ data: { projectId, type: "WBS", input: { sourceTaskId: source.id }, output: { ...(suggestion.output as object), title: "合成移交清单", description: "所属阶段：验收与运维\n经人工确认的阶段" } } }));
    const adopted = await acceptWbsSuggestion({ suggestionId: explicit.id, actorId });
    expect(adopted.task.description).toContain("所属阶段：验收与运维"); expect(adopted.task.planningStatus).toBe("UNSCHEDULED");
  });
  it("template tasks all pass plan validation and have a durable pending marker", async () => {
    const project = await createProject({ name: "模板双轨项目", description: "合成", initializeStandardTasks: true }, { actorId });
    const tasks = await db.task.findMany({ where: { projectId: project.id } }); expect(tasks).toHaveLength(14); expect(tasks.every(t => t.planningStatus === "UNSCHEDULED" && Number(t.estimateHours) > 0 && t.description?.startsWith("所属阶段：") && t.completionRoundId)).toBe(true);
  });
  it("preserves plans and records user-entered actual dates, effort and round atomically", async () => {
    const task = await create(); await changeTaskStatus({ taskId: task.id, actorId, status: "IN_PROGRESS" });
    const patch = (expectedCompletionRoundId: string | null) => PATCH(new Request(`http://localhost/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ ...actual(), actorId: undefined, expectedCompletionRoundId }) }), { params: Promise.resolve({ taskId: task.id }) });
    expect((await patch(randomUUID())).status).toBe(409);
    const response = await patch(task.completionRoundId); expect(response.status).toBe(200);
    const signed = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(signed.completedAt?.toISOString()).toBe(`${actualDate()}T00:00:00.000Z`); expect(Number(signed.actualHours)).toBe(10.25); expect(signed.dueDate).toEqual(task.dueDate); expect(signed.estimateHours).toEqual(task.estimateHours); expect(signed.createdAt).toEqual(task.createdAt);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: task.id, action: "TASK_SIGNED_AND_COMPLETED" } }); expect(audit.after).toMatchObject({ actualHours: 10.25, completedAt: signed.completedAt!.toISOString(), completionRoundId: signed.completionRoundId }); expect(audit.createdAt.getTime()).toBeGreaterThan(signed.completedAt!.getTime()); expect(JSON.stringify(audit)).not.toContain(password);
    expect((await db.$transaction(tx => readCounts(tx, projectId))).MISSING_SIGNATURES).toBe(0); expect(await db.$transaction(tx => unsignedTaskCount(tx, state.actor!, projectId))).toBe(0);
    const snapshot = await db.$transaction(tx => acceptanceEvidence(tx, projectId, 3)); expect(snapshot.tasks[0]).toMatchObject({ estimateHours: "8", actualHours: "10.25", dueDate: "2026-12-01T00:00:00.000Z", completedAt: signed.completedAt!.toISOString(), completionRoundId: signed.completionRoundId });
  });
  it.each(["TODO", "IN_PROGRESS"] as const)("reopening to %s clears all actuals and invalidates same-day historic evidence", async status => {
    const task = await create(); await changeTaskStatus({ taskId: task.id, actorId, status: "IN_PROGRESS" }); const signed = await changeTaskStatus({ ...actual(), taskId: task.id });
    const opened = await changeTaskStatus({ taskId: task.id, actorId, status, expectedRowVersion: signed.rowVersion }); expect(opened.actualHours).toBeNull(); expect(opened.completedAt).toBeNull(); expect(opened.completionRoundId).toBeNull();
    // Simulate a bypassed status write in this isolated DB: old same-day signature must not cover it.
    await db.$transaction(tx => tx.task.update({ where: { id: task.id }, data: { status: "DONE", completedAt: signed.completedAt, actualHours: signed.actualHours } }));
    expect((await db.$transaction(tx => readCounts(tx, projectId))).MISSING_SIGNATURES).toBe(1); expect(await db.$transaction(tx => unsignedTaskCount(tx, state.actor!, projectId))).toBe(1);
    await db.$transaction(tx => tx.task.update({ where: { id: task.id }, data: { status: "IN_PROGRESS", completedAt: null, actualHours: null } }));
    await expect(changeTaskStatus({ ...actual(), taskId: task.id, expectedCompletionRoundId: signed.completionRoundId })).rejects.toMatchObject({ status: 409 });
    await changeTaskStatus({ ...actual(), taskId: task.id, expectedCompletionRoundId: opened.completionRoundId, expectedRowVersion: (await db.task.findUniqueOrThrow({ where: { id: task.id } })).rowVersion }); expect((await db.$transaction(tx => readCounts(tx, projectId))).MISSING_SIGNATURES).toBe(0); expect(await db.auditLog.count({ where: { entityId: task.id, action: "TASK_SIGNED_AND_COMPLETED" } })).toBe(2);
  });
  it("rejects missing/future actual dates and preserves values if signature audit fails", async () => {
    const task = await create(); await changeTaskStatus({ taskId: task.id, actorId, status: "IN_PROGRESS" });
    for (const completedAt of [undefined, "2099-12-31", "2026-02-30"]) {
      const response = await PATCH(new Request(`http://localhost/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ ...actual(), actorId: undefined, completedAt }) }), { params: Promise.resolve({ taskId: task.id }) }); expect(response.status).toBe(400);
    }
    state.failAudit = true; await expect(changeTaskStatus({ ...actual(), taskId: task.id })).rejects.toThrow("Synthetic audit outage");
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: "IN_PROGRESS", completedAt: null, actualHours: null, completionRoundId: task.completionRoundId }); expect(await db.auditLog.count({ where: { entityId: task.id, action: "TASK_SIGNED_AND_COMPLETED" } })).toBe(0);
  });
  it("legacy timestamps and version-one evidence remain unchanged", async () => {
    const completedAt = new Date("2026-10-12T12:34:56.789Z");
    const task = await db.$transaction(tx => tx.task.create({ data: { projectId, title: "Legacy signed task", status: "DONE", completedAt, actualHours: 2 } }));
    await db.$transaction(tx => tx.auditLog.create({ data: { actorId, projectId, action: "TASK_SIGNED_AND_COMPLETED", entityType: "Task", entityId: task.id, after: { status: "DONE", completedAt: completedAt.toISOString(), signatureReason: "确认任务已完成" } } }));
    expect(task.completionRoundId).toBeNull(); expect((await db.$transaction(tx => readCounts(tx, projectId))).MISSING_SIGNATURES).toBe(0);
    const snapshot = await db.$transaction(tx => acceptanceEvidence(tx, projectId, 1)); expect(Object.keys(snapshot.tasks[0]).sort()).toEqual(["actualHours", "id", "requiresDeliverable", "status", "title"]); expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).completedAt).toEqual(completedAt);
  });
});
