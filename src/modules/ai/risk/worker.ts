import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { recordAudit } from "@/modules/audit/service";
import { lockPlanningProject } from "@/modules/planning/repositories";
import { PlanningError } from "@/modules/planning/schemas";
import { participant } from "@/modules/auth/project-access";
import { lockUsers } from "@/modules/auth/transaction-locks";
import { scanProjectRisks } from "./service";
import { nextRiskRun } from "./scheduler-service";
import * as repository from "./scheduler-repositories";
const AGENT = "risk-scheduler-worker";
export async function enqueueDueRiskScan(now = new Date()) {
  const candidate = await repository.dueSchedule(now); if (!candidate) return false;
  return prisma.$transaction(async (tx) => {
    await lockPlanningProject(tx, candidate.projectId);
    await lockUsers(tx, [SYSTEM_USER_ID]);
    const schedule = await repository.scheduleById(tx, candidate.id);
    if (!schedule?.enabled || schedule.nextRunAt > now) return false;
    // Advance even when a previous job remains active; do not create a catch-up storm.
    if (await repository.activeJob(tx, schedule.id) || await repository.jobAtDue(tx, schedule.id, schedule.nextRunAt)) { await repository.advanceSchedule(tx, schedule.id, nextRiskRun(now, schedule.intervalMinutes)); return false; }
    const job = await repository.insertJob(tx, { scheduleId: schedule.id, scheduleVersion: schedule.version, projectId: schedule.projectId, dueAt: schedule.nextRunAt, nextRunAt: now });
    await repository.advanceSchedule(tx, schedule.id, nextRiskRun(now, schedule.intervalMinutes));
    await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: schedule.projectId, action: "RISK_JOB_QUEUED", entityType: "RiskScanJob", entityId: job.id, after: { scheduleId: schedule.id, scheduleVersion: schedule.version, configuredById: schedule.configuredById, dueAt: job.dueAt.toISOString() }, userAgent: AGENT });
    return true;
  }, { isolationLevel: "ReadCommitted" });
}
export async function claimRiskJob(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const candidate = await repository.candidateJob(tx, now); if (!candidate) return null;
    await lockPlanningProject(tx, candidate.projectId);
    await lockUsers(tx, [SYSTEM_USER_ID]);
    const token = randomUUID(); const exhausted = candidate.attempts >= 3;
    const changed = await repository.updateJob(tx, { where: { id: candidate.id, status: { in: ["QUEUED", "RUNNING"] }, attempts: candidate.attempts, nextRunAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: exhausted ? { status: "FAILED", errorCode: "RISK_ATTEMPTS_EXHAUSTED", completedAt: now, leaseToken: null, leaseUntil: null } : { status: "RUNNING", attempts: { increment: 1 }, leaseToken: token, leaseUntil: new Date(now.getTime() + 60000) } });
    if (changed.count !== 1) return null;
    await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: candidate.projectId, action: exhausted ? "RISK_JOB_FAILED" : "RISK_JOB_STARTED", entityType: "RiskScanJob", entityId: candidate.id, after: { attempt: exhausted ? candidate.attempts : candidate.attempts + 1, reason: exhausted ? "RISK_ATTEMPTS_EXHAUSTED" : null }, userAgent: AGENT });
    return exhausted ? null : { ...candidate, attempts: candidate.attempts + 1, leaseToken: token };
  }, { isolationLevel: "ReadCommitted" });
}
type ClaimedRiskJob = NonNullable<Awaited<ReturnType<typeof claimRiskJob>>>;
export async function executeRiskJob(job: ClaimedRiskJob) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockPlanningProject(tx, job.projectId);
      const schedule = await repository.scheduleById(tx, job.scheduleId);
      await lockUsers(tx, [SYSTEM_USER_ID, ...(schedule ? [schedule.configuredById, ...(schedule.project.ownerId ? [schedule.project.ownerId] : [])] : [])]);
      const [configuredBy] = schedule ? await tx.$queryRaw<{ role: string; status: string; isSystem: boolean }[]>`SELECT role, status, isSystem FROM User WHERE id = ${schedule.configuredById} FOR UPDATE` : [];
      const now = new Date();
      const owns = await repository.updateJob(tx, { where: { id: job.id, status: "RUNNING", leaseToken: job.leaseToken, leaseUntil: { gt: now } }, data: { leaseUntil: new Date(now.getTime() + 60000) } });
      if (owns.count !== 1) return false;
      const reason = !schedule?.enabled || schedule.version !== job.scheduleVersion ? "RISK_SCHEDULE_CHANGED" : !configuredBy || configuredBy.status !== "ACTIVE" || configuredBy.role !== "PM" || configuredBy.isSystem || !await participant(tx, job.projectId, schedule.configuredById) ? "RISK_AUTHORIZATION_REVOKED" : ["COMPLETED", "ON_HOLD"].includes(schedule.project.status) ? "RISK_PROJECT_PAUSED" : null;
      if (reason) {
        await repository.updateJob(tx, { where: { id: job.id, leaseToken: job.leaseToken }, data: { status: "SKIPPED", errorCode: reason, completedAt: now, leaseUntil: null, leaseToken: null } });
        if (reason === "RISK_AUTHORIZATION_REVOKED") {
          const disabled = await repository.disableSchedule(tx, job.scheduleId);
          await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: job.projectId, action: "RISK_SCHEDULE_UPDATED", entityType: "RiskScanSchedule", entityId: job.scheduleId, before: { enabled: true, version: schedule!.version }, after: { enabled: false, version: disabled.version, reason }, userAgent: AGENT });
        }
        await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: job.projectId, action: "RISK_JOB_SKIPPED", entityType: "RiskScanJob", entityId: job.id, after: { reason }, userAgent: AGENT });
        return true;
      }
      const result = await scanProjectRisks(tx, { projectId: job.projectId, actorId: SYSTEM_USER_ID, now, userAgent: AGENT }, [schedule!.configuredById]);
      await repository.updateJob(tx, { where: { id: job.id, leaseToken: job.leaseToken }, data: { status: "SUCCEEDED", errorCode: null, batchId: result.batchId, suggestionCount: result.data.length, completedAt: new Date(), leaseToken: null, leaseUntil: null } });
      await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: job.projectId, action: "RISK_JOB_COMPLETED", entityType: "RiskScanJob", entityId: job.id, after: { batchId: result.batchId, suggestionCount: result.data.length, configuredById: schedule!.configuredById }, userAgent: AGENT });
      return true;
    }, { isolationLevel: "RepeatableRead", timeout: 20000 });
  } catch (error) {
    const terminal = job.attempts >= 3 || error instanceof PlanningError;
    await prisma.$transaction(async (tx) => {
      await lockPlanningProject(tx, job.projectId);
      await lockUsers(tx, [SYSTEM_USER_ID]);
      const changed = await repository.updateJob(tx, { where: { id: job.id, status: "RUNNING", leaseToken: job.leaseToken, leaseUntil: { gt: new Date() } }, data: { status: terminal ? "FAILED" : "QUEUED", errorCode: error instanceof PlanningError ? "RISK_SCAN_DATA_LIMIT" : "RISK_SCAN_FAILED", nextRunAt: new Date(Date.now() + 10000 * 2 ** job.attempts), completedAt: terminal ? new Date() : null, leaseToken: null, leaseUntil: null } });
      if (!changed.count) return;
      await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: job.projectId, action: "RISK_JOB_FAILED", entityType: "RiskScanJob", entityId: job.id, after: { attempt: job.attempts, terminal, errorCode: error instanceof PlanningError ? "RISK_SCAN_DATA_LIMIT" : "RISK_SCAN_FAILED" }, userAgent: AGENT });
    }, { isolationLevel: "ReadCommitted" });
    return false;
  }
}
export async function runRiskWorkerTick() { await enqueueDueRiskScan(); const job = await claimRiskJob(); return job ? executeRiskJob(job) : false; }
export async function runRiskWorker(once = false, signal?: AbortSignal) {
  do {
    try { await runRiskWorkerTick(); } catch { console.error("Risk worker iteration failed; durable jobs remain recoverable"); }
    if (once || signal?.aborted) break;
    try { await delay(5000, undefined, { signal }); } catch { break; }
  } while (!signal?.aborted);
  await prisma.$disconnect();
}
