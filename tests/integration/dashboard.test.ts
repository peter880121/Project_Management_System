import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient, type Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: null as { id: string; role: string } | null }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: async () => state.actor }));
import { GET } from "@/app/api/dashboard/stats/route";
import { dashboardStats } from "@/modules/dashboard/service";
const source = new URL(process.env.DATABASE_URL!); const name = `medpm_dash_it_${randomUUID().replaceAll("-", "")}`; const target = new URL(source); target.pathname = `/${name}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD!; adminUrl.pathname = "/mysql";
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const db = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [{ emit: "event", level: "query" }] }); state.db = db;
const queries: string[] = []; db.$on("query", event => queries.push(event.query));
const now = new Date("2026-10-19T04:00:00Z"); let pmId: string, foreignPmId: string, qaId: string, memberId: string, pmoId: string, adminId: string; let ownId: string, foreignId: string, sharedId: string;
async function actor(role: Role) { const id = { PM: pmId, PMO: pmoId, ADMIN: adminId, QA: qaId, MEMBER: memberId }[role]; state.actor = { id, role }; }
describe.sequential("PMO aggregates and defensive project filtering against isolated MySQL", () => {
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Local isolated MySQL required");
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: target.toString() }, stdio: "pipe", windowsHide: true });
    await db.$transaction(async tx => {
      const ids = [];
      for (const role of ["PM", "PM", "QA", "MEMBER", "PMO", "ADMIN"] as const) ids.push((await tx.user.create({ data: { name: `Synthetic ${role}`, email: `${randomUUID()}@medpm.local`, role, status: "ACTIVE" } })).id);
      [pmId, foreignPmId, qaId, memberId, pmoId, adminId] = ids;
      ownId = (await tx.project.create({ data: { name: "Visible portfolio", ownerId: pmId, status: "ACTIVE" } })).id;
      foreignId = (await tx.project.create({ data: { name: "FOREIGN SECRET PROJECT", ownerId: foreignPmId, status: "ACTIVE" } })).id;
      sharedId = (await tx.project.create({ data: { name: "Shared portfolio", ownerId: foreignPmId, status: "ACTIVE" } })).id;
      await tx.projectMember.create({ data: { projectId: sharedId, userId: pmId } });
      const completedAt = new Date("2026-10-18T10:00:00.123Z");
      for (const [title, signed] of [["Signed completion", true], ["Old signature is insufficient", false]] as const) {
        const task = await tx.task.create({ data: { projectId: ownId, title, status: "DONE", completedAt, dueDate: new Date("2026-10-01") } });
        await tx.auditLog.create({ data: { actorId: pmId, projectId: ownId, entityType: "Task", entityId: task.id, action: "TASK_SIGNED_AND_COMPLETED", after: { status: "DONE", signatureReason: "确认任务已完成", completedAt: new Date(completedAt.getTime() - (signed ? 0 : 1000)).toISOString() } } });
      }
      await tx.task.createMany({ data: [
        { projectId: ownId, title: "Overdue blocker", status: "BLOCKED", assigneeId: qaId, dueDate: new Date("2026-10-01") },
        { projectId: ownId, title: "Scheduled", assigneeId: memberId, dueDate: new Date("2026-11-01") },
        { projectId: ownId, title: "Unassigned" },
        { projectId: sharedId, title: "Shared assignment", assigneeId: qaId },
        { projectId: foreignId, title: "FOREIGN SECRET TASK", status: "DONE", completedAt },
        { projectId: foreignId, title: "FOREIGN OVERDUE", assigneeId: qaId, dueDate: new Date("2026-09-01") },
      ] });
      await tx.aiSuggestion.createMany({ data: [
        { projectId: ownId, type: "RISK", input: {}, output: {}, status: "PENDING", createdAt: new Date(now.getTime() - 86400000) },
        { projectId: ownId, type: "RISK", input: {}, output: {}, status: "REJECTED", createdAt: now },
        { projectId: ownId, type: "RISK", input: {}, output: {}, status: "PENDING", createdAt: new Date("2026-09-01") },
        { projectId: foreignId, type: "RISK", input: {}, output: {}, status: "PENDING", createdAt: now },
      ] });
      for (const createdAt of [new Date("2026-09-30T15:59:59.000Z"), new Date("2026-09-30T15:59:59.999Z"), new Date("2026-09-30T16:00:00.000Z")]) {
        const d = await tx.document.create({ data: { projectId: ownId, filename: "synthetic-boundary.pdf", minioKey: `synthetic/${randomUUID()}`, mediaType: "application/pdf" } }); const id = randomUUID();
        await tx.deliverable.create({ data: { id, seriesId: id, projectId: ownId, documentId: d.id, name: "Synthetic monthly version", createdById: pmId, createdAt } });
        await tx.project.create({ data: { name: "Synthetic archived boundary", ownerId: pmId, status: "ARCHIVED", archivedAt: createdAt } });
      }
    });
  }, 60000);
  afterAll(async () => { await db.$disconnect(); await admin.$disconnect(); });
  it("uses database aggregates and only bounded entity hydration", async () => {
    queries.length = 0; const stats = await dashboardStats(pmId, { healthPage: 1, loadPage: 1 }, now);
    expect(stats.metrics).toEqual({ activeProjects: 2, archivedProjects: 3, overdueTasks: 1, unsignedTasks: 1 });
    expect(stats.workload.rows.find(r => r.assigneeId === qaId)?.count).toBe(2); expect(stats.workload.unassigned).toBe(1);
    const p = stats.health.rows.find(p => p.id === ownId)!; expect(p).toMatchObject({ total: 5, done: 2, progress: 40, overdue: 1, blocked: 1, recentRisks: 1 });
    expect(JSON.stringify(stats)).not.toContain("FOREIGN");
    expect(queries.some(q => /GROUP BY/i.test(q))).toBe(true); expect(queries.some(q => /NOT EXISTS/i.test(q))).toBe(true);
    for (const q of queries.filter(q => /^SELECT/i.test(q.trim()) && !/COUNT\(|GROUP BY|NOT EXISTS/i.test(q))) expect(q).toMatch(/LIMIT|WHERE.*User.*id|WHERE.*`id`/i);
  });
  it.each(["ADMIN", "PMO"] as const)("allows %s to aggregate globally without project membership", async role => {
    const stats = await dashboardStats(role === "ADMIN" ? adminId : pmoId, { healthPage: 1, loadPage: 1 }, now);
    expect(stats.metrics.activeProjects).toBe(3); expect(stats.metrics.unsignedTasks).toBe(2); expect(stats.scope).toBe("GLOBAL");
  });
  it("counts real DATETIME(3) last-second/millisecond and midnight rows in correct HK months", async () => {
    const stats = await dashboardStats(pmId, { healthPage: 1, loadPage: 1 }, now);
    expect(stats.trend.find(r => r.month === "2026-09")).toEqual({ month: "2026-09", archivedProjects: 2, deliverableVersions: 2 });
    expect(stats.trend.find(r => r.month === "2026-10")).toEqual({ month: "2026-10", archivedProjects: 1, deliverableVersions: 1 });
    expect(stats.trend).toHaveLength(6);
  });
  it("returns entirely empty aggregates when PM injects another project's ID and page", async () => {
    await actor("PM"); const response = await GET(new Request(`http://localhost/api/dashboard/stats?projectId=${foreignId}&healthPage=2&loadPage=2`));
    expect(response.status).toBe(200); const { data } = await response.json();
    expect(data.metrics).toEqual({ activeProjects: 0, overdueTasks: 0, unsignedTasks: 0, archivedProjects: 0 });
    expect(data.health).toMatchObject({ rows: [], total: 0 }); expect(data.workload).toMatchObject({ rows: [], unassigned: 0, hasMore: false }); expect(data.trend.every((r: { archivedProjects: number; deliverableVersions: number }) => !r.archivedProjects && !r.deliverableVersions)).toBe(true);
    expect(response.headers.get("Cache-Control")).toContain("no-store"); expect(JSON.stringify(data)).not.toContain("FOREIGN");
  });
  it.each(["QA", "MEMBER"] as const)("rejects %s at API before parsing params or touching aggregation", async role => {
    await actor(role); queries.length = 0; expect((await GET(new Request("http://localhost/api/dashboard/stats?projectId=malformed"))).status).toBe(403); expect(queries).toHaveLength(0);
  });
  it("rechecks revoked membership and database role on each query", async () => {
    await db.$transaction(tx => tx.projectMember.updateMany({ where: { projectId: sharedId, userId: pmId }, data: { active: false } }));
    expect((await dashboardStats(pmId, { projectId: sharedId, healthPage: 1, loadPage: 1 }, now)).health.total).toBe(0);
    await actor("PMO"); await db.$transaction(tx => tx.user.update({ where: { id: pmoId }, data: { role: "QA" } }));
    expect((await GET(new Request("http://localhost/api/dashboard/stats"))).status).toBe(403);
    await db.$transaction(tx => tx.user.update({ where: { id: pmoId }, data: { role: "PMO" } }));
  });
  it("leaves all business evidence untouched and supports an empty/out-of-range project page", async () => {
    const before = [await db.task.count(), await db.auditLog.count(), await db.deliverable.count()];
    const empty = await dashboardStats(pmId, { projectId: randomUUID(), healthPage: 1, loadPage: 1 }, now); expect(empty.health.rows).toEqual([]);
    const page = await dashboardStats(pmId, { healthPage: 10000, loadPage: 10000 }, now); expect(page.health.rows).toEqual([]); expect(page.workload.rows).toEqual([]);
    expect([await db.task.count(), await db.auditLog.count(), await db.deliverable.count()]).toEqual(before);
  });
});
