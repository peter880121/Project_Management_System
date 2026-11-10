import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, failAudit: false }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
import { maintainProject } from "@/modules/projects/maintenance";
import { updateTaskDetails } from "@/modules/tasks/details";
import { setProjectMember } from "@/modules/projects/members";
import { changeProjectLifecycle } from "@/modules/projects/lifecycle";
import { transitionProject } from "@/modules/projects/acceptance";
import { changeTaskStatus } from "@/modules/audit/service";
import { hashPassword } from "@/modules/auth/password";
import { businessToday } from "@/modules/tasks/plan";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (state.failAudit) throw new Error("Synthetic maintenance audit outage"); return query(args); } } } });
let pm: string, successor: string, other: string, member: string, admin: string, qa: string, projectId: string, taskId: string;
const password = randomUUID();
const edit = (expectedRowVersion = 1) => ({ operation: "details" as const, expectedRowVersion, name: "Renamed synthetic project", description: "Revised scope" });
const transfer = (ownerId = successor, expectedRowVersion = 1) => ({ operation: "transfer" as const, expectedRowVersion, ownerId, confirmationName: "Synthetic maintenance", reason: "Synthetic documented project manager handoff" });
const taskInput = (expectedRowVersion = 1) => ({ operation: "details" as const, expectedRowVersion, title: "Renamed task", description: "Updated synthetic instructions", phase: "自定义验证阶段" });
describe.sequential("project and task maintenance in real MySQL", () => {
  beforeAll(async () => {
    if (!/^medpm_test_ia_/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) throw new Error("Requires isolated test database");
    const passwordHash = await hashPassword(password);
    [pm, successor, other, member, admin, qa] = await db.$transaction(async tx => { const ids: string[] = []; for (const role of ["PM", "PM", "PM", "MEMBER", "ADMIN", "QA"] as const) ids.push((await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: `Synthetic ${role}`, role, status: "ACTIVE", passwordHash } })).id); return ids; });
  });
  beforeEach(async () => {
    state.failAudit = false;
    await db.$transaction(async tx => {
      projectId = (await tx.project.create({ data: { name: "Synthetic maintenance", ownerId: pm, status: "ACTIVE" } })).id;
      await tx.projectMember.create({ data: { projectId, userId: member } });
      taskId = (await tx.task.create({ data: { projectId, title: "Original task", description: "所属阶段：项目启动\nOriginal", estimateHours: 8, status: "TODO" } })).id;
    });
  });
  afterAll(() => db.$disconnect());
  it.each(["PM", "ADMIN"])("allows %s to update project details with before/after evidence", async role => {
    const saved = await maintainProject(projectId, edit(), { actorId: role === "PM" ? pm : admin });
    expect(saved).toMatchObject({ name: edit().name, rowVersion: 2 });
    expect((await db.auditLog.findFirstOrThrow({ where: { projectId, action: "PROJECT_DETAILS_UPDATED" } })).before).toMatchObject({ name: "Synthetic maintenance", rowVersion: 1 });
    await expect(maintainProject(projectId, edit(), { actorId: pm })).rejects.toMatchObject({ status: 409 });
  });
  it("denies foreign PM and member writes, including participating non-owner PM", async () => {
    await expect(maintainProject(projectId, edit(), { actorId: other })).rejects.toMatchObject({ status: 403 });
    await expect(updateTaskDetails(taskId, taskInput(), { actorId: member })).rejects.toMatchObject({ status: 403 });
    await db.$transaction(tx => tx.projectMember.create({ data: { projectId, userId: other } }));
    await expect(maintainProject(projectId, edit(), { actorId: other })).rejects.toMatchObject({ status: 403 });
  });
  it("hands off ownership, preserves access, revokes old override and rejects old manager authority", async () => {
    await db.$transaction(tx => tx.projectMember.create({ data: { projectId, userId: pm, canOverrideAcceptance: true } }));
    const saved = await maintainProject(projectId, transfer(), { actorId: pm }); expect(saved.ownerId).toBe(successor);
    const members = await db.projectMember.findMany({ where: { projectId, userId: { in: [pm, successor] } } });
    expect(members).toHaveLength(2); expect(members.every(row => row.active && !row.canOverrideAcceptance)).toBe(true);
    await expect(maintainProject(projectId, edit(2), { actorId: pm })).rejects.toMatchObject({ status: 403 });
    await expect(setProjectMember(projectId, { userId: member, active: false, expectedVersion: 1 }, { actorId: pm })).rejects.toMatchObject({ status: 403 });
    expect((await maintainProject(projectId, edit(2), { actorId: successor })).rowVersion).toBe(3);
    expect(await db.auditLog.count({ where: { projectId, action: "PROJECT_OWNER_TRANSFERRED" } })).toBe(1);
  });
  it("rejects inactive, non-PM, same-owner and incorrect confirmation targets", async () => {
    for (const input of [transfer(member), transfer(pm), transfer(pm.toUpperCase()), { ...transfer(), confirmationName: "wrong" }]) await expect(maintainProject(projectId, input, { actorId: pm })).rejects.toMatchObject({ status: 400 });
    const inactive = await db.$transaction(tx => tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Inactive PM", role: "PM", status: "DISABLED" } }));
    await expect(maintainProject(projectId, transfer(inactive.id), { actorId: admin })).rejects.toMatchObject({ status: 400 });
  });
  it("serializes competing handoffs so only one observed version commits", async () => {
    const results = await Promise.allSettled([maintainProject(projectId, transfer(), { actorId: admin }), maintainProject(projectId, transfer(other), { actorId: admin })]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditLog.count({ where: { projectId, action: "PROJECT_OWNER_TRANSFERRED" } })).toBe(1);
  });
  it("updates task text and custom phase without changing plan or actual evidence", async () => {
    const saved = await updateTaskDetails(taskId, taskInput(), { actorId: pm });
    expect(saved).toMatchObject({ title: "Renamed task", description: "所属阶段：自定义验证阶段\nUpdated synthetic instructions", rowVersion: 2, actualHours: null, completedAt: null });
    expect(Number(saved.estimateHours)).toBe(8);
    await expect(updateTaskDetails(taskId, taskInput(), { actorId: admin })).rejects.toMatchObject({ status: 409 });
    expect(await db.auditLog.count({ where: { entityId: taskId, action: "TASK_DETAILS_UPDATED" } })).toBe(1);
  });
  it.each(["DONE", "CANCELLED"] as const)("refuses edits to %s task evidence", async status => {
    await db.$transaction(tx => tx.task.update({ where: { id: taskId }, data: status === "DONE" ? { status } : { status, cancelReason: "Synthetic cancellation documented", cancelledAt: new Date(), cancelledById: pm } }));
    await expect(updateTaskDetails(taskId, taskInput(2), { actorId: pm })).rejects.toMatchObject({ status: 409 });
  });
  it.each(["pause", "cancel"] as const)("reuses project freeze for all edits after %s", async action => {
    await changeProjectLifecycle(projectId, action, { expectedRowVersion: 1, requestKey: randomUUID(), reason: "Synthetic documented lifecycle operation", ...(action === "cancel" ? { confirmationName: "Synthetic maintenance" } : {}) }, { actorId: pm });
    await expect(maintainProject(projectId, edit(2), { actorId: pm })).rejects.toThrow(/项目已/);
    await expect(maintainProject(projectId, transfer(successor, 2), { actorId: pm })).rejects.toThrow(/项目已/);
    await expect(updateTaskDetails(taskId, taskInput(), { actorId: pm })).rejects.toThrow(/项目已/);
  });
  it.each(["PENDING_ACCEPTANCE", "ARCHIVED"])("denies maintenance in %s without touching signed evidence", async status => {
    await db.$transaction(tx => tx.projectMember.create({ data: { projectId, userId: qa } }));
    const started = await changeTaskStatus({ taskId, status: "IN_PROGRESS", expectedRowVersion: 1, actorId: pm });
    const signed = await changeTaskStatus({ taskId, status: "DONE", expectedRowVersion: started.rowVersion, actualHours: 2, completedAt: businessToday(), signaturePassword: password, signatureReason: "确认任务已完成", actorId: pm });
    const submitted = await transitionProject(projectId, "submit-acceptance", { expectedRowVersion: 1, requestKey: randomUUID(), comment: "" }, { actorId: pm });
    if (status === "ARCHIVED") {
      const approved = await transitionProject(projectId, "qa-approve", { expectedRowVersion: 2, requestKey: randomUUID(), acceptanceId: submitted.currentAcceptanceId!, comment: "Synthetic QA approval" }, { actorId: qa });
      await transitionProject(projectId, "archive", { expectedRowVersion: approved.rowVersion, requestKey: randomUUID(), acceptanceId: approved.currentAcceptanceId!, comment: "" }, { actorId: admin });
    }
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    await expect(maintainProject(projectId, edit(project.rowVersion), { actorId: admin })).rejects.toThrow(/禁止修改|业务资料已锁定/);
    await expect(maintainProject(projectId, transfer(successor, project.rowVersion), { actorId: admin })).rejects.toThrow(/禁止修改|业务资料已锁定/);
    await expect(updateTaskDetails(taskId, taskInput(signed.rowVersion), { actorId: pm })).rejects.toThrow(/禁止修改|业务资料已锁定/);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).completionRoundId).toBe(signed.completionRoundId);
  });
  it.each(["project", "transfer", "task"])("rolls back %s writes when audit persistence fails", async kind => {
    state.failAudit = true;
    await expect(kind === "task" ? updateTaskDetails(taskId, taskInput(), { actorId: pm }) : maintainProject(projectId, kind === "transfer" ? transfer() : edit(), { actorId: pm })).rejects.toThrow("Synthetic maintenance audit outage");
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({ name: "Synthetic maintenance", ownerId: pm, rowVersion: 1 });
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ title: "Original task", rowVersion: 1 });
    expect(await db.projectMember.count({ where: { projectId, userId: successor } })).toBe(0);
    expect(await db.auditLog.count({ where: { projectId } })).toBe(0);
  });
});
