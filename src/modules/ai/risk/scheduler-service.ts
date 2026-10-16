import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { lockPlanningActor } from "@/modules/planning/repositories";
import { PlanningError } from "@/modules/planning/schemas";
import * as repository from "./scheduler-repositories";
export const riskScheduleSchema = z.object({ enabled: z.boolean(), intervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(360), z.literal(1440)]), expectedVersion: z.number().int().nonnegative() }).strict();
export function nextRiskRun(now: Date, intervalMinutes: number) { return new Date(now.getTime() + intervalMinutes * 60000); }
export async function configureRiskSchedule(projectId: string, input: z.infer<typeof riskScheduleSchema>, actor: { actorId: string } & AuditRequestMetadata) {
  return prisma.$transaction(async (tx) => {
    await lockPlanningActor(tx, actor.actorId, projectId);
    if (!await repository.projectById(tx, projectId)) throw new PlanningError("项目不存在", 404);
    const prior = await repository.findSchedule(tx, projectId);
    if ((prior?.version ?? 0) !== input.expectedVersion) throw new PlanningError("扫描计划已变化，请刷新", 409);
    if (prior) for (const job of await repository.pendingJobs(tx, prior.id)) {
      await repository.updateJob(tx, { where: { id: job.id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "SKIPPED", errorCode: "RISK_SCHEDULE_CHANGED", completedAt: new Date(), leaseToken: null, leaseUntil: null } });
      await recordAudit(tx, { ...actor, projectId, action: "RISK_JOB_SKIPPED", entityType: "RiskScanJob", entityId: job.id, after: { reason: "RISK_SCHEDULE_CHANGED", previousScheduleVersion: prior.version } });
    }
    const row = await repository.saveSchedule(tx, { projectId, configuredById: actor.actorId, enabled: input.enabled, intervalMinutes: input.intervalMinutes, nextRunAt: new Date() });
    await recordAudit(tx, { ...actor, projectId, action: "RISK_SCHEDULE_UPDATED", entityType: "RiskScanSchedule", entityId: row.id, before: prior ? { enabled: prior.enabled, intervalMinutes: prior.intervalMinutes, version: prior.version, configuredById: prior.configuredById } : undefined, after: { enabled: row.enabled, intervalMinutes: row.intervalMinutes, version: row.version, configuredById: row.configuredById, nextRunAt: row.nextRunAt.toISOString() } });
    return { id: row.id, version: row.version };
  }, { isolationLevel: "ReadCommitted" });
}
export async function getRiskSchedule(projectId: string) {
  const exists = await prisma.$transaction((tx) => repository.projectById(tx, projectId)); if (!exists) throw new PlanningError("项目不存在", 404);
  const [schedule, jobs] = await Promise.all([repository.readSchedule(projectId), repository.listJobs(projectId)]);
  return { schedule: schedule ?? { enabled: false, intervalMinutes: 60, version: 0, nextRunAt: null }, jobs };
}
export async function retryRiskJob(id: string, actor: { actorId: string } & AuditRequestMetadata) {
  // Read scope first; all mutable checks are repeated after acquiring project/job locks.
  const initial = await prisma.$transaction((tx) => repository.loadJob(tx, id)); if (!initial) throw new PlanningError("扫描任务不存在", 404);
  return prisma.$transaction(async (tx) => {
    await lockPlanningActor(tx, actor.actorId, initial.projectId);
    const job = await repository.loadJob(tx, id); if (!job || job.status !== "FAILED") throw new PlanningError("仅失败任务可重试", 409);
    const schedule = await repository.scheduleById(tx, job.scheduleId);
    if (!schedule?.enabled || schedule.version !== job.scheduleVersion) throw new PlanningError("计划已关闭或更新，请重新启用计划", 409);
    if (await repository.activeJob(tx, schedule.id)) throw new PlanningError("项目已有待执行扫描", 409);
    const changed = await repository.updateJob(tx, { where: { id, status: "FAILED" }, data: { status: "QUEUED", attempts: 0, nextRunAt: new Date(), completedAt: null, errorCode: null, leaseToken: null, leaseUntil: null } });
    if (!changed.count) throw new PlanningError("扫描任务已变化", 409);
    await recordAudit(tx, { ...actor, projectId: job.projectId, action: "RISK_JOB_RETRIED", entityType: "RiskScanJob", entityId: id, before: { status: "FAILED", attempts: job.attempts }, after: { status: "QUEUED" } });
    return { id, status: "QUEUED" };
  }, { isolationLevel: "ReadCommitted" });
}
