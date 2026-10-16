import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const connected = vi.hoisted(() => ({ client: undefined as unknown as import("@prisma/client").PrismaClient }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return connected.client; } }));
import { getProjectPlanning, updateMemberCapacity, updateTaskSchedule } from "@/modules/planning/services";
import { generateProjectRiskWarnings } from "@/modules/ai/risk/service";
if (!process.env.DATABASE_URL || !process.env.MYSQL_ROOT_PASSWORD) throw new Error("Planning integration requires local MySQL credentials");
const source = new URL(process.env.DATABASE_URL); if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Only local MySQL is allowed");
const name = `medpm_planning_it_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
const testUrl = new URL(source); testUrl.pathname = `/${name}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } }); const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } }); connected.client = db;
let actorId: string; let secondActorId: string; let memberId: string; let projectId: string; let a: string; let b: string; let foreignTask: string;
const week = new Date("2026-10-12T00:00:00Z");
const plan = (dependencyIds: string[] = [], expectedVersion = 0) => ({ expectedVersion, plannedStartDate: "2026-10-12", dueDate: "2026-10-18", estimateHours: 30, dependencyIds });
function sql(input: string) { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, input, stdio: "pipe" }); }
describe.sequential("planning and capacity in isolated MySQL", () => {
  beforeAll(async () => {
    if (!/^medpm_planning_it_[a-f0-9]{32}$/.test(name)) throw new Error("Unexpected test database");
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });
  }, 60000);
  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      actorId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic planning PM", role: "PM", status: "ACTIVE" } })).id;
      secondActorId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic second planning PM", role: "PM", status: "ACTIVE" } })).id;
      memberId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic capacity member", role: "MEMBER", status: "ACTIVE" } })).id;
      projectId = (await tx.project.create({ data: { name: "Synthetic planning project", ownerId: actorId } })).id;
      await tx.projectMember.createMany({ data: [secondActorId, memberId].map((userId) => ({ projectId, userId })) });
      const other = await tx.project.create({ data: { name: "Synthetic second project", ownerId: actorId } });
      a = (await tx.task.create({ data: { projectId, title: "Synthetic A", assigneeId: memberId } })).id;
      b = (await tx.task.create({ data: { projectId, title: "Synthetic B" } })).id;
      foreignTask = (await tx.task.create({ data: { projectId: other.id, title: "Synthetic cross-project load", assigneeId: memberId } })).id;
    });
  });
  afterAll(async () => { await db.$disconnect(); try { if (/^medpm_planning_it_[a-f0-9]{32}$/.test(name)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await admin.$disconnect(); } });
  it("saves schedule/dependencies and audited UTC date semantics atomically", async () => {
    await updateTaskSchedule(a, plan([b]), { actorId, ip: "192.0.2.90", userAgent: "synthetic-planning-test" });
    const task = await db.task.findUniqueOrThrow({ where: { id: a } }); expect(task.scheduleVersion).toBe(1); expect(task.dueDate?.toISOString()).toBe("2026-10-18T23:59:59.999Z"); expect(task.status).toBe("TODO");
    expect(await db.taskDependency.count({ where: { taskId: a } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: a, action: "TASK_SCHEDULE_UPDATED" } }); expect(audit.before).toMatchObject({ version: 0 }); expect(audit.after).toMatchObject({ version: 1, dependencyIds: [b] });
  });
  it("rejects foreign and cyclic dependencies and stale schedule versions", async () => {
    await expect(updateTaskSchedule(a, plan([foreignTask]), { actorId })).rejects.toMatchObject({ status: 400 });
    await updateTaskSchedule(a, plan([b]), { actorId }); await expect(updateTaskSchedule(b, plan([a]), { actorId })).rejects.toMatchObject({ status: 400 });
    await expect(updateTaskSchedule(a, plan(), { actorId })).rejects.toMatchObject({ status: 409 });
    expect(await db.taskDependency.count({ where: { taskId: a } })).toBe(1);
  });
  it("serializes competing dependency edits so reciprocal cycles cannot be committed", async () => {
    const result = await Promise.allSettled([updateTaskSchedule(a, plan([b]), { actorId }), updateTaskSchedule(b, plan([a]), { actorId: secondActorId })]);
    expect(result.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(await db.taskDependency.count({ where: { taskId: { in: [a, b] } } })).toBe(1);
  });
  it("keeps completed historical schedules read-only and rechecks PM status", async () => {
    await db.$transaction((tx) => tx.task.update({ where: { id: a }, data: { status: "DONE" } }));
    await expect(updateTaskSchedule(a, plan(), { actorId })).rejects.toMatchObject({ status: 409 });
    await db.$transaction((tx) => tx.user.update({ where: { id: actorId }, data: { role: "QA" } }));
    await expect(updateTaskSchedule(b, plan(), { actorId })).rejects.toMatchObject({ status: 403 });
    await expect(updateMemberCapacity(memberId, { weekStart: "2026-10-12", hours: 40, expectedVersion: 0 }, { actorId })).rejects.toMatchObject({ status: 403 });
  });
  it("counts cross-project capacity, distinguishes zero/null and rejects stale edits", async () => {
    await updateTaskSchedule(a, plan(), { actorId }); await updateTaskSchedule(foreignTask, plan(), { actorId });
    await updateMemberCapacity(memberId, { weekStart: "2026-10-12", hours: 40, expectedVersion: 0 }, { actorId });
    const data = await getProjectPlanning(projectId, week); const load = data.loads.find((row) => row.userId === memberId)!;
    expect(load).toMatchObject({ plannedHours: 60, overloaded: true, capacityHours: 40, projectCount: 2 }); expect(load.projectIds).toEqual([projectId]); expect(load.taskIds).not.toContain(foreignTask);
    await expect(updateMemberCapacity(memberId, { weekStart: "2026-10-12", hours: 20, expectedVersion: 0 }, { actorId })).rejects.toMatchObject({ status: 409 });
    await updateMemberCapacity(memberId, { weekStart: "2026-10-12", hours: 0, expectedVersion: 1 }, { actorId });
    expect((await getProjectPlanning(projectId, week)).loads.find((row) => row.userId === memberId)?.overloaded).toBe(true);
    await updateMemberCapacity(memberId, { weekStart: "2026-10-12", hours: null, expectedVersion: 2 }, { actorId });
    expect((await getProjectPlanning(projectId, week)).loads.find((row) => row.userId === memberId)?.overloaded).toBeNull();
  });
  it("generates deduplicated capacity evidence without changing tasks and retains prior snapshots after edits", async () => {
    await updateTaskSchedule(a, plan(), { actorId }); await updateTaskSchedule(foreignTask, plan(), { actorId });
    await updateMemberCapacity(memberId, { weekStart: "2026-10-12", hours: 40, expectedVersion: 0 }, { actorId });
    const before = await db.task.findMany({ where: { id: { in: [a, b, foreignTask] } }, orderBy: { id: "asc" } });
    const result = await generateProjectRiskWarnings({ projectId, actorId, now: week }); expect(result.data.length).toBeGreaterThan(0);
    const risk = result.data.find((row) => (row.output as { taskId: string }).taskId === a)!;
    expect(risk.output).toMatchObject({ capacityEvidence: { plannedHours: 60, capacityHours: 40 } });
    expect((await generateProjectRiskWarnings({ projectId, actorId, now: week })).data).toHaveLength(0);
    expect(await db.task.findMany({ where: { id: { in: [a, b, foreignTask] } }, orderBy: { id: "asc" } })).toEqual(before);
    await updateMemberCapacity(memberId, { weekStart: "2026-10-12", hours: 20, expectedVersion: 1 }, { actorId });
    const updated = await generateProjectRiskWarnings({ projectId, actorId, now: week }); expect(updated.data.length).toBeGreaterThan(0);
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: risk.id } })).output).toEqual(risk.output);
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: risk.id } })).status).toBe("PENDING");
  });
  it("rolls back scheduling, capacity and risk creation when audit fails", async () => {
    sql("CREATE TRIGGER planning_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure';");
    try {
      await expect(updateTaskSchedule(a, plan([b]), { actorId })).rejects.toThrow();
      await expect(updateMemberCapacity(memberId, { weekStart: "2026-10-12", hours: 40, expectedVersion: 0 }, { actorId })).rejects.toThrow();
      await expect(generateProjectRiskWarnings({ projectId, actorId, now: week })).rejects.toThrow();
    } finally { sql("DROP TRIGGER planning_it_fail_audit;"); }
    expect((await db.task.findUniqueOrThrow({ where: { id: a } })).scheduleVersion).toBe(0); expect(await db.taskDependency.count({ where: { taskId: a } })).toBe(0);
    expect(await db.memberWeeklyCapacity.count({ where: { userId: memberId } })).toBe(0); expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
  });
  it("supports structural rollback while preserving task rows and audit evidence", async () => {
    await updateTaskSchedule(a, plan(), { actorId }); const count = await db.auditLog.count(); const directory = "prisma/migrations/20261015040000_scheduling_capacity/";
    sql(readFileSync(directory + "down.sql", "utf8")); expect(await db.auditLog.count()).toBe(count); expect(await db.$queryRaw`SELECT id, dueDate FROM Task WHERE id = ${a}`).toHaveLength(1);
    sql(readFileSync(directory + "migration.sql", "utf8")); expect((await db.task.findUniqueOrThrow({ where: { id: a } })).scheduleVersion).toBe(0);
  });
});
