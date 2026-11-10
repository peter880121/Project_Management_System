import { REQUIREMENT_PROJECT_TABLES } from "@/modules/projects/freeze-manifest";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient, type ProjectStatus } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, failAudit: false }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
import { changeProjectLifecycle } from "@/modules/projects/lifecycle";
import { transitionProject } from "@/modules/projects/acceptance";
import { freezeErrorResponse } from "@/modules/projects/freeze";
import { assertProjectWritable } from "@/modules/projects/write-scope";
import { lockProjectForWrite } from "@/modules/auth/transaction-locks";
import { buildDocumentChunksTick, syncDocumentVectorTick } from "@/modules/documents/rag-worker";
import { syncAssetSourceTick } from "@/modules/assets/source-worker";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (state.failAudit) throw new Error("Synthetic lifecycle audit failure"); return query(args); } } } });
const reason = "合成测试：客户暂停预算，等待资源确认后继续执行。";
const input = (expectedRowVersion: number) => ({ expectedRowVersion, requestKey: randomUUID(), reason });
let pmId: string, adminId: string, memberId: string, otherPmId: string, projectId: string, taskId: string, meetingId: string, documentId: string;
async function createProject(status: ProjectStatus = "ACTIVE", origin?: string) {
  return db.$transaction(tx => tx.project.create({ data: { name: "Synthetic lifecycle project", ownerId: pmId, status, pausedFromStatus: origin } }));
}
async function rejected(operation: () => Promise<unknown>, status: string) {
  try { await operation(); throw new Error("Expected frozen write rejection"); } catch (error) { const response = freezeErrorResponse(error)!; expect(response?.status).toBe(403); expect(await response.json()).toMatchObject({ code: "PROJECT_FROZEN", projectStatus: status }); }
}
describe.sequential("pause/cancel using the existing real MySQL freeze boundary", () => {
  beforeAll(async () => {
    if (!/^medpm_test_ia_/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) throw new Error("Run with scripts/test-project-ia.mjs, isolated database required");
    const users = await db.$transaction(async tx => {
      const ids: string[] = [];
      for (const role of ["PM", "ADMIN", "MEMBER", "PM"] as const) ids.push((await tx.user.create({ data: { role, status: "ACTIVE", name: "Synthetic lifecycle actor", email: `${randomUUID()}@medpm.local` } })).id);
      return ids;
    }); [pmId, adminId, memberId, otherPmId] = users;
  });
  beforeEach(async () => {
    state.failAudit = false;
    await db.$transaction(async tx => {
      projectId = (await tx.project.create({ data: { name: "Synthetic lifecycle project", ownerId: pmId, status: "ACTIVE" } })).id;
      await tx.projectMember.createMany({ data: [memberId, otherPmId].map(userId => ({ projectId, userId })) });
      taskId = (await tx.task.create({ data: { projectId, title: "Synthetic lifecycle task", status: "IN_PROGRESS", estimateHours: 8, dueDate: new Date("2026-10-21T00:00:00.000Z") } })).id;
      meetingId = (await tx.meetingRecord.create({ data: { projectId, title: "Synthetic meeting", meetingDate: new Date(), content: "Synthetic content", actionItems: [], requestKey: randomUUID(), createdById: pmId, visibleRoles: ["PM"] } })).id;
      documentId = (await tx.document.create({ data: { projectId, filename: "Synthetic.pdf", mediaType: "application/pdf", minioKey: `synthetic/${randomUUID()}`, storageStatus: "AVAILABLE" } })).id;
    });
  });
  afterAll(() => db.$disconnect());
  it("retains the original and requirement shared freeze triggers and indexed primary-key locking", async () => {
    const [row] = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME LIKE 'freeze_%'`;
    expect(Number(row.n)).toBe(60 + 3 * REQUIREMENT_PROJECT_TABLES.length);
    const plan = await db.$queryRawUnsafe<Record<string, string>[]>("EXPLAIN FORMAT=JSON SELECT status FROM Project WHERE id=? FOR UPDATE", projectId);
    expect(Object.values(plan[0])[0]).toMatch(/"key":\s*"PRIMARY"/);
  });
  it("can reapply the additive migration without removing project data or audit evidence", async () => {
    const before = await Promise.all([db.project.count(), db.task.count(), db.auditLog.count()]);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/migrations/20261024000000_project_pause_cancel/migration.sql", "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true });
    expect(await Promise.all([db.project.count(), db.task.count(), db.auditLog.count()])).toEqual(before);
  }, 30000);
  it("rolls back an unused schema and reapplies it without touching business rows", async () => {
    const before = await Promise.all([db.project.count(), db.task.count(), db.auditLog.count()]);
    for (const file of ["rollback.sql", "migration.sql"]) execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", `prisma/migrations/20261024000000_project_pause_cancel/${file}`, "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true });
    expect(await Promise.all([db.project.count(), db.task.count(), db.auditLog.count()])).toEqual(before);
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).pausedFromStatus).toBeNull();
  }, 30000);
  it.each(["PLANNING", "ACTIVE"] as const)("resumes exactly from %s and preserves task plan and actual fields", async origin => {
    const project = await createProject(origin); const paused = await changeProjectLifecycle(project.id, "pause", input(1), { actorId: pmId });
    expect(paused.project).toMatchObject({ status: "ON_HOLD", pausedFromStatus: origin });
    const resumed = await changeProjectLifecycle(project.id, "resume", input(2), { actorId: pmId }); expect(resumed.project.status).toBe(origin);
    expect(await db.projectStatusChange.count({ where: { projectId: project.id } })).toBe(2);
    expect(await db.auditLog.count({ where: { projectId: project.id, action: { in: ["PROJECT_PAUSED", "PROJECT_RESUMED"] } } })).toBe(2);
    expect(await db.task.findUnique({ where: { id: taskId } })).toMatchObject({ status: "IN_PROGRESS", actualHours: null, completedAt: null, dueDate: new Date("2026-10-21T00:00:00Z") });
  });
  it.each([undefined, "BROKEN", "ARCHIVED", "planning", "PLANNING "])("legacy or corrupted origin %s restores only to ACTIVE", async origin => {
    const project = await createProject("ON_HOLD", origin);
    expect((await changeProjectLifecycle(project.id, "resume", input(1), { actorId: adminId })).project.status).toBe("ACTIVE");
  });
  it("rejects blank explanations, mismatched confirmation and arbitrary caller status", async () => {
    for (const body of [{ ...input(1), reason: " " }, { ...input(1), status: "ACTIVE" }]) await expect(changeProjectLifecycle(projectId, "pause", body, { actorId: pmId })).rejects.toMatchObject({ status: 400 });
    await expect(changeProjectLifecycle(projectId, "cancel", { ...input(1), confirmationName: "wrong" }, { actorId: pmId })).rejects.toMatchObject({ status: 400 });
    expect(await db.projectStatusChange.count({ where: { projectId } })).toBe(0);
  });
  it("rejects participant PM/MEMBER and cross-project actors but allows ADMIN", async () => {
    for (const actorId of [memberId, otherPmId]) await expect(changeProjectLifecycle(projectId, "pause", input(1), { actorId })).rejects.toMatchObject({ status: 403 });
    const other = await db.$transaction(tx => tx.project.create({ data: { ownerId: otherPmId, name: "Synthetic unrelated project", status: "ACTIVE" } }));
    await expect(changeProjectLifecycle(other.id, "pause", input(1), { actorId: pmId })).rejects.toMatchObject({ status: 403 });
    expect((await changeProjectLifecycle(projectId, "pause", input(1), { actorId: adminId })).project.status).toBe("ON_HOLD");
  });
  it("serializes concurrent state changes, rejects stale versions, and replays one idempotent event", async () => {
    const body = input(1); const outcomes = await Promise.allSettled([changeProjectLifecycle(projectId, "pause", body, { actorId: pmId }), changeProjectLifecycle(projectId, "pause", body, { actorId: pmId })]);
    expect(outcomes.every(row => row.status === "fulfilled")).toBe(true); expect(await db.projectStatusChange.count({ where: { projectId } })).toBe(1);
    await expect(changeProjectLifecycle(projectId, "resume", input(1), { actorId: pmId })).rejects.toMatchObject({ status: 409 });
    await expect(changeProjectLifecycle(projectId, "pause", { ...body, reason: reason + "changed" }, { actorId: pmId })).rejects.toMatchObject({ status: 409 });
  });
  it("a concurrent task write either commits before pause or is rejected by the same project lock", async () => {
    const [, write] = await Promise.allSettled([
      changeProjectLifecycle(projectId, "pause", input(1), { actorId: pmId }),
      db.$transaction(async tx => { await lockProjectForWrite(tx, projectId); await tx.task.update({ where: { id: taskId }, data: { title: "Synthetic concurrent update" } }); }, { isolationLevel: "ReadCommitted" }),
    ]);
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("ON_HOLD");
    if (write.status === "rejected") { expect(freezeErrorResponse(write.reason)?.status).toBe(403); expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).title).toBe("Synthetic lifecycle task"); }
    else expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).title).toBe("Synthetic concurrent update");
  });
  it("rolls back status, lifecycle evidence and audit together if audit fails", async () => {
    state.failAudit = true; await expect(changeProjectLifecycle(projectId, "pause", input(1), { actorId: pmId })).rejects.toThrow("Synthetic lifecycle audit failure");
    expect(await db.project.findUnique({ where: { id: projectId } })).toMatchObject({ status: "ACTIVE", rowVersion: 1, currentStatusChangeId: null });
    expect(await db.projectStatusChange.count({ where: { projectId } })).toBe(0); expect(await db.auditLog.count({ where: { projectId } })).toBe(0);
  });
  it.each(["pause", "cancel"] as const)("HTTP, transactions and raw SQL all freeze %s writes", async action => {
    const target = action === "pause" ? "ON_HOLD" : "CANCELLED";
    const body = action === "cancel" ? { ...input(1), confirmationName: "Synthetic lifecycle project" } : input(1);
    const result = await changeProjectLifecycle(projectId, action, body, { actorId: pmId });
    await rejected(() => assertProjectWritable(projectId), target);
    await rejected(() => db.$transaction(tx => lockProjectForWrite(tx, projectId, true)), target);
    await rejected(() => db.$executeRaw`INSERT INTO Task(id,projectId,title,status,createdAt,updatedAt) VALUES(${randomUUID()},${projectId},'Synthetic bypass','TODO',NOW(3),NOW(3))`, target);
    await rejected(() => db.$executeRaw`UPDATE Task SET title='tampered' WHERE id=${taskId}`, target);
    await rejected(() => db.$executeRaw`DELETE FROM Task WHERE id=${taskId}`, target);
    await rejected(() => db.$executeRaw`UPDATE Document SET filename='tampered.pdf' WHERE id=${documentId}`, target);
    await rejected(() => db.$executeRaw`UPDATE ProjectMember SET active=FALSE WHERE projectId=${projectId}`, target);
    await rejected(() => db.$executeRaw`DELETE FROM MeetingRecord WHERE id=${meetingId}`, target);
    await rejected(() => db.$executeRaw`UPDATE Project SET name='tampered' WHERE id=${projectId}`, target);
    await rejected(() => db.$executeRaw`UPDATE Project SET status='ACTIVE' WHERE id=${projectId}`, target);
    await rejected(() => db.$executeRaw`DELETE FROM Project WHERE id=${projectId}`, target);
    await rejected(() => transitionProject(projectId, "activate", { ...input(2), comment: "" }, { actorId: pmId }), target);
    await expect(db.$executeRaw`UPDATE ProjectStatusChange SET reason='tampered' WHERE id=${result.change.id}`).rejects.toThrow("ER_STATUS_CHANGE_IMMUTABLE");
    await expect(db.$executeRaw`DELETE FROM ProjectStatusChange WHERE id=${result.change.id}`).rejects.toThrow("ER_STATUS_CHANGE_IMMUTABLE");
    if (action === "cancel") await rejected(() => changeProjectLifecycle(projectId, "resume", input(2), { actorId: pmId }), target);
  });
  it("requires withdrawing acceptance and never permits archived state transitions", async () => {
    const pending = await createProject("PENDING_ACCEPTANCE"); await expect(changeProjectLifecycle(pending.id, "pause", input(1), { actorId: pmId })).rejects.toMatchObject({ status: 409 });
    const archived = await createProject("ARCHIVED"); await expect(changeProjectLifecycle(archived.id, "resume", input(1), { actorId: adminId })).rejects.toMatchObject({ archived: true });
    await expect(db.$executeRaw`UPDATE Project SET status='ON_HOLD' WHERE id=${projectId}`).rejects.toThrow("ER_STATUS_CHANGE_REQUIRED");
  });
  it("can cancel a paused project without touching frozen tasks", async () => {
    await changeProjectLifecycle(projectId, "pause", input(1), { actorId: pmId });
    const result = await changeProjectLifecycle(projectId, "cancel", { ...input(2), confirmationName: "Synthetic lifecycle project" }, { actorId: pmId });
    expect(result.project.status).toBe("CANCELLED"); expect(await db.task.count({ where: { projectId } })).toBe(1);
    expect(() => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/migrations/20261024000000_project_pause_cancel/rollback.sql", "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true })).toThrow();
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("CANCELLED");
    expect(await db.projectStatusChange.count({ where: { projectId } })).toBe(2);
  });
  it("background worker candidates exclude paused and cancelled projects", async () => {
    // Seeded unrelated active jobs need not be claimed: observe filtered candidate queries directly.
    const embed = vi.fn(async () => Array(1536).fill(0)); const upsert = vi.fn(async () => {}); const put = vi.fn(async () => {});
    await changeProjectLifecycle(projectId, "pause", input(1), { actorId: pmId });
    expect(await syncAssetSourceTick(put)).toBe(false); expect(await buildDocumentChunksTick()).toBe(false); expect(await syncDocumentVectorTick({ embed, upsert })).toBe(false); expect(embed).not.toHaveBeenCalled();
  });
});
