import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const connected = vi.hoisted(() => ({ client: undefined as unknown as import("@prisma/client").PrismaClient }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return connected.client; } }));
import { configureRiskSchedule, retryRiskJob } from "@/modules/ai/risk/scheduler-service";
import { claimRiskJob, enqueueDueRiskScan, executeRiskJob, runRiskWorkerTick } from "@/modules/ai/risk/worker";
import { getRiskNotificationDetail, getRiskNotifications, readRiskNotification } from "@/modules/ai/risk/notifications";
import { generateProjectRiskWarnings } from "@/modules/ai/risk/service";
import { SYSTEM_USER_ID } from "@/lib/system-user";
if (!process.env.DATABASE_URL || !process.env.MYSQL_ROOT_PASSWORD) throw new Error("Risk scheduler integration requires local MySQL credentials");
const source = new URL(process.env.DATABASE_URL); if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Only local MySQL is allowed");
const name = `medpm_risk_it_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
const testUrl = new URL(source); testUrl.pathname = `/${name}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } }); const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } }); connected.client = db;
let actorId: string; let ownerId: string; let outsiderId: string; let projectId: string; let taskId: string;
const config = (enabled = true, expectedVersion = 0) => ({ enabled, expectedVersion, intervalMinutes: 60 as const });
function sql(input: string) { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, input, stdio: "pipe" }); }
async function makeDue() { await db.$transaction((tx) => tx.riskScanSchedule.updateMany({ where: { projectId }, data: { nextRunAt: new Date(0) } })); }
describe.sequential("durable risk scheduler and personal notifications", () => {
  beforeAll(async () => {
    if (!/^medpm_risk_it_[a-f0-9]{32}$/.test(name)) throw new Error("Unexpected isolated database name");
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });
    await db.$transaction((tx) => tx.user.create({ data: { id: SYSTEM_USER_ID, email: "system@medpm.local", name: "Synthetic system", isSystem: true, status: "DISABLED" } }));
  }, 60000);
  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      await tx.riskScanSchedule.updateMany({ data: { enabled: false } }); await tx.riskScanJob.updateMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "SKIPPED" } });
      actorId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic scheduler PM", role: "PM", status: "ACTIVE" } })).id;
      ownerId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic owner PM", role: "PM", status: "ACTIVE" } })).id;
      outsiderId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic unrelated PM", role: "PM", status: "ACTIVE" } })).id;
      projectId = (await tx.project.create({ data: { name: "Synthetic automatic risk project", ownerId } })).id;
      await tx.projectMember.create({ data: { projectId, userId: actorId } });
      taskId = (await tx.task.create({ data: { projectId, title: "Synthetic overdue release check", dueDate: new Date("2026-01-01T23:59:59.999Z") } })).id;
    });
  });
  afterAll(async () => { await db.$disconnect(); try { if (/^medpm_risk_it_[a-f0-9]{32}$/.test(name)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await admin.$disconnect(); } });
  it("requires explicit PM enablement and optimistic schedule versions", async () => {
    expect(await enqueueDueRiskScan()).toBe(false);
    await configureRiskSchedule(projectId, config(), { actorId });
    await expect(configureRiskSchedule(projectId, config(), { actorId })).rejects.toMatchObject({ status: 409 });
    await db.$transaction((tx) => tx.user.update({ where: { id: actorId }, data: { role: "QA" } }));
    await expect(configureRiskSchedule(projectId, config(false, 1), { actorId })).rejects.toMatchObject({ status: 403 });
  });
  it("disables automatic scans when the configuring PM loses project membership", async () => {
    await configureRiskSchedule(projectId, config(), { actorId });
    await db.$transaction((tx) => tx.projectMember.updateMany({ where: { projectId, userId: actorId }, data: { active: false } }));
    await runRiskWorkerTick();
    expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
    expect((await db.riskScanSchedule.findUniqueOrThrow({ where: { projectId } })).enabled).toBe(false);
    expect((await getRiskNotifications(actorId, 1)).data).toEqual([]);
  });
  it("queues once across concurrent schedulers and skips catch-up while a job is active", async () => {
    await configureRiskSchedule(projectId, config(), { actorId }); await makeDue();
    const result = await Promise.all([enqueueDueRiskScan(), enqueueDueRiskScan()]); expect(result.filter(Boolean)).toHaveLength(1);
    expect(await db.riskScanJob.count({ where: { projectId } })).toBe(1); await makeDue(); expect(await enqueueDueRiskScan()).toBe(false);
    expect(await db.riskScanJob.count({ where: { projectId } })).toBe(1);
  });
  it("atomically completes a system scan and notifies only owner and configuring PM", async () => {
    await configureRiskSchedule(projectId, config(), { actorId }); const before = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(await runRiskWorkerTick()).toBe(true);
    const job = await db.riskScanJob.findFirstOrThrow({ where: { projectId } }); expect(job).toMatchObject({ status: "SUCCEEDED", suggestionCount: 1 });
    const suggestion = await db.aiSuggestion.findFirstOrThrow({ where: { projectId } }); expect(suggestion.status).toBe("PENDING");
    expect(await db.riskNotification.count({ where: { suggestionId: suggestion.id } })).toBe(2);
    expect((await getRiskNotifications(actorId, 1)).unreadCount).toBe(1); expect((await getRiskNotifications(ownerId, 1)).unreadCount).toBe(1); expect((await getRiskNotifications(outsiderId, 1)).data).toEqual([]);
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId } })).toEqual(before);
    expect(await db.auditLog.count({ where: { entityId: job.id, actorId: SYSTEM_USER_ID, action: "RISK_JOB_COMPLETED" } })).toBe(1);
    await makeDue(); await runRiskWorkerTick(); expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(1); expect(await db.riskNotification.count({ where: { suggestionId: suggestion.id } })).toBe(2);
  });
  it("fences an expired worker and lets its replacement publish only once", async () => {
    await configureRiskSchedule(projectId, config(), { actorId }); await enqueueDueRiskScan(); const old = (await claimRiskJob())!;
    await db.$transaction((tx) => tx.riskScanJob.update({ where: { id: old.id }, data: { leaseUntil: new Date(0) } }));
    const recovered = (await claimRiskJob())!; expect(recovered.leaseToken).not.toBe(old.leaseToken);
    expect(await executeRiskJob(old)).toBe(false); expect(await executeRiskJob(recovered)).toBe(true); expect(await executeRiskJob(recovered)).toBe(false);
    expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(1);
  });
  it("advances an already processed schedule slot instead of permanently retrying a duplicate key", async () => {
    await configureRiskSchedule(projectId, config(), { actorId }); await runRiskWorkerTick();
    const job = await db.riskScanJob.findFirstOrThrow({ where: { projectId } });
    await db.$transaction((tx) => tx.riskScanSchedule.update({ where: { projectId }, data: { nextRunAt: job.dueAt } }));
    expect(await enqueueDueRiskScan()).toBe(false); expect(await db.riskScanJob.count({ where: { projectId } })).toBe(1);
    expect((await db.riskScanSchedule.findUniqueOrThrow({ where: { projectId } })).nextRunAt.getTime()).toBeGreaterThan(job.dueAt.getTime());
  });
  it("cancels queued/claimed jobs when a plan changes or is disabled", async () => {
    await configureRiskSchedule(projectId, config(), { actorId }); await enqueueDueRiskScan(); const claimed = (await claimRiskJob())!;
    await configureRiskSchedule(projectId, config(false, 1), { actorId }); expect(await executeRiskJob(claimed)).toBe(false);
    expect((await db.riskScanJob.findUniqueOrThrow({ where: { id: claimed.id } })).status).toBe("SKIPPED"); expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
    await configureRiskSchedule(projectId, config(true, 2), { actorId }); expect(await runRiskWorkerTick()).toBe(true);
  });
  it("serializes a worker claim with plan cancellation without holding a job before its project", async () => {
    await configureRiskSchedule(projectId, config(), { actorId }); await enqueueDueRiskScan();
    let signalClaim = () => {}; let resume = () => {}; let signalCancel = () => {};
    const claimRead = new Promise<void>((resolve) => { signalClaim = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const cancelAttempt = new Promise<void>((resolve) => { signalCancel = resolve; });
    let pause = true; let cancelling = false;
    const pausedClient = db.$extends({ query: {
      async $queryRaw({ args, query }) {
        if (cancelling && JSON.stringify(args).includes("FROM Project")) signalCancel();
        return query(args);
      }, riskScanJob: { async updateMany({ args, query }) {
        const result = await query(args);
        if (pause && args.data.status === "RUNNING") { pause = false; signalClaim(); await gate; }
        return result;
      } },
    } });
    connected.client = pausedClient as unknown as PrismaClient;
    const claiming = claimRiskJob();
    let cancellation: ReturnType<typeof configureRiskSchedule> | undefined;
    try {
      await claimRead;
      cancelling = true;
      cancellation = configureRiskSchedule(projectId, config(false, 1), { actorId });
      await cancelAttempt;
    } finally { connected.client = db; pause = false; resume(); }
    const claimed = await claiming; expect(claimed).not.toBeNull(); await cancellation;
    expect(await executeRiskJob(claimed!)).toBe(false);
    expect(await db.riskScanJob.findUniqueOrThrow({ where: { id: claimed!.id } })).toMatchObject({ status: "SKIPPED", leaseToken: null });
    expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: claimed!.id, action: "RISK_JOB_STARTED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: claimed!.id, action: "RISK_JOB_SKIPPED" } })).toBe(1);
  });
  it("stops revoked authorizations and skips paused projects", async () => {
    await configureRiskSchedule(projectId, config(), { actorId }); await db.$transaction((tx) => tx.user.update({ where: { id: actorId }, data: { status: "DISABLED" } }));
    await runRiskWorkerTick(); expect((await db.riskScanSchedule.findUniqueOrThrow({ where: { projectId } })).enabled).toBe(false);
    expect((await db.riskScanJob.findFirstOrThrow({ where: { projectId } })).errorCode).toBe("RISK_AUTHORIZATION_REVOKED");
    await configureRiskSchedule(projectId, config(true, 2), { actorId: ownerId });
    await db.$transaction((tx) => tx.project.update({ where: { id: projectId }, data: { status: "ON_HOLD" } }));
    await runRiskWorkerTick(); expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
  });
  it("rolls back results and notifications on audit failure, bounds retries and supports explicit retry", async () => {
    await configureRiskSchedule(projectId, config(), { actorId }); await enqueueDueRiskScan();
    sql("CREATE TRIGGER risk_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW BEGIN IF NEW.action = 'RISK_JOB_COMPLETED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure'; END IF; END;");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await db.$transaction((tx) => tx.riskScanJob.updateMany({ where: { projectId }, data: { nextRunAt: new Date(0) } }));
        const claimed = (await claimRiskJob())!; expect(await executeRiskJob(claimed)).toBe(false);
      }
    } finally { sql("DROP TRIGGER risk_it_fail_audit;"); }
    const job = await db.riskScanJob.findFirstOrThrow({ where: { projectId } }); expect(job).toMatchObject({ status: "FAILED", attempts: 3 });
    expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0); expect(await db.riskNotification.count({ where: { userId: actorId } })).toBe(0);
    await retryRiskJob(job.id, { actorId }); expect(await runRiskWorkerTick()).toBe(true);
    expect((await db.riskScanJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SUCCEEDED");
  });
  it("marks only a recipient's notification read without handling the underlying risk", async () => {
    await generateProjectRiskWarnings({ projectId, actorId }); const notification = (await getRiskNotifications(actorId, 1)).data[0];
    await expect(readRiskNotification(notification.id, { actorId: outsiderId })).rejects.toMatchObject({ status: 404 });
    await expect(getRiskNotificationDetail(notification.id, outsiderId)).rejects.toMatchObject({ status: 404 });
    expect((await getRiskNotificationDetail(notification.id, actorId)).suggestion.output).toMatchObject({ taskId });
    await readRiskNotification(notification.id, { actorId }); await readRiskNotification(notification.id, { actorId });
    expect((await getRiskNotifications(actorId, 1)).unreadCount).toBe(0); expect((await getRiskNotifications(ownerId, 1)).unreadCount).toBe(1);
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: notification.suggestionId } })).status).toBe("PENDING");
    expect(await db.auditLog.count({ where: { entityId: notification.id, action: "RISK_NOTIFICATION_READ" } })).toBe(1);
  });
  it("rolls back schedule settings and read acknowledgements when audit is unavailable", async () => {
    await generateProjectRiskWarnings({ projectId, actorId }); const notification = (await getRiskNotifications(actorId, 1)).data[0];
    sql("CREATE TRIGGER risk_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure';");
    try { await expect(configureRiskSchedule(projectId, config(), { actorId })).rejects.toThrow(); await expect(readRiskNotification(notification.id, { actorId })).rejects.toThrow(); }
    finally { sql("DROP TRIGGER risk_it_fail_audit;"); }
    expect(await db.riskScanSchedule.count({ where: { projectId } })).toBe(0); expect((await getRiskNotifications(actorId, 1)).unreadCount).toBe(1);
  });
  it("structurally rolls back scheduler tables while preserving risks and audit evidence", async () => {
    await configureRiskSchedule(projectId, config(), { actorId }); await runRiskWorkerTick(); const count = await db.auditLog.count();
    const directory = "prisma/migrations/20261015050000_risk_scheduler_notifications/";
    sql(readFileSync(directory + "down.sql", "utf8")); expect(await db.auditLog.count()).toBe(count); expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(1);
    sql(readFileSync(directory + "migration.sql", "utf8")); expect(await db.riskNotification.count()).toBe(0);
  });
});
