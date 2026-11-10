import { liveRiskTaskClause } from "./visibility";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { analyzeProjectRisks, type RiskFinding, type RiskTask } from "./rules";
import { calculateWeeklyLoad, utcWeekStart } from "@/modules/planning/rules";
import { loadPlanningSnapshot, lockPlanningActor } from "@/modules/planning/repositories";
import { notifyRiskSuggestions } from "./notifications";
import { lockProjectForWrite, lockUsers } from "@/modules/auth/transaction-locks";

export type RiskSuggestion = { id: string; output: Prisma.JsonValue; createdAt: Date };

// MySQL normalizes JSON object key order. Compare complete evidence canonically,
// including contributor IDs, rather than only the human-readable message.
function warningSignature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(warningSignature).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${warningSignature(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function buildRiskSuggestions(findings: RiskFinding[], batchId: string) {
  return findings.map((finding) => ({
    id: randomUUID(),
    type: "RISK" as const,
    status: "PENDING" as const,
    input: { batchId, ruleVersion: "2", taskId: finding.taskId },
    output: {
      taskId: finding.taskId,
      taskTitle: finding.taskTitle,
      severity: finding.severity,
      evidence: finding.evidence,
      relatedTaskIds: finding.relatedTaskIds,
      historicalDelayRate: finding.historicalDelayRate,
      historySampleSize: finding.historySampleSize,
      ...(finding.capacityEvidence ? { capacityEvidence: finding.capacityEvidence } : {}),
    } satisfies Prisma.InputJsonValue,
  }));
}

export async function generateProjectRiskWarnings(input: { projectId: string; actorId: string; now?: Date } & AuditRequestMetadata) {
  return prisma.$transaction(async (tx) => {
    await lockProjectForWrite(tx, input.projectId);
    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { ownerId: true } });
    await lockUsers(tx, [input.actorId, ...(project?.ownerId ? [project.ownerId] : [])]);
    await lockPlanningActor(tx, input.actorId);
    return scanProjectRisks(tx, input);
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}

/** Internal transactional primitive. Callers must authorize and lock the project before invoking. */
export async function scanProjectRisks(tx: Prisma.TransactionClient, input: { projectId: string; actorId: string; now?: Date } & AuditRequestMetadata, recipientIds = [input.actorId]) {
    const batchId = randomUUID();
    const weekStart = utcWeekStart(input.now); const snapshot = await loadPlanningSnapshot(tx, input.projectId, weekStart);
    const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
    const tasks: RiskTask[] = snapshot.tasks.filter(task => task.status !== "CANCELLED").map((task) => ({ ...task, dependencies: task.dependencies.flatMap((edge) => {
      const dependency = byId.get(edge.dependsOnTaskId); return dependency ? [{ id: dependency.id, title: dependency.title, status: dependency.status, dueDate: dependency.dueDate }] : [];
    }) }));
    const findings = analyzeProjectRisks(tasks, input.now);
    const loads = calculateWeeklyLoad(snapshot.loadTasks.map((row) => ({ ...row, estimateHours: row.estimateHours === null ? null : Number(row.estimateHours) })), snapshot.members, snapshot.capacities.map((row) => ({ ...row, hours: row.hours === null ? null : Number(row.hours) })), weekStart);
    for (const task of snapshot.tasks) {
      if (["DONE", "CANCELLED"].includes(task.status) || !task.assigneeId) continue;
      const load = loads.find((row) => row.userId === task.assigneeId); if (!load) continue;
      const evidence: string[] = [];
      if (load.overloaded && load.taskIds.includes(task.id)) evidence.push(`${load.name} 在 ${weekStart.toISOString().slice(0, 10)} 起的一周跨项目计划工时 ${load.plannedHours} 小时，超过已配置容量 ${load.capacityHours} 小时（按日历天均摊，${load.projectIds.length} 个项目）。`);
      if (load.incompleteTaskIds.includes(task.id)) evidence.push("任务排期不完整或已逾期但未完成，未纳入本周工时统计，需补齐或重新确认排期才能可靠判断容量。");
      if (load.capacityHours === null && load.taskIds.includes(task.id)) evidence.push(`${load.name} 尚未配置本周容量，无法判断计划工时 ${load.plannedHours} 小时是否超载。`);
      if (!evidence.length) continue;
      let finding = findings.find((row) => row.taskId === task.id);
      if (!finding) { finding = { taskId: task.id, taskTitle: task.title, severity: "MEDIUM", evidence: [], relatedTaskIds: [], historicalDelayRate: null, historySampleSize: 0 }; findings.push(finding); }
      finding.evidence.push(...evidence);
      finding.capacityEvidence = { weekStart: weekStart.toISOString().slice(0, 10), plannedHours: load.plannedHours, capacityHours: load.capacityHours, taskIds: load.taskIds.filter((id) => byId.has(id)).slice(0, 100), projectIds: load.projectIds.filter((id) => id === input.projectId), incompleteTaskIds: load.incompleteTaskIds.filter((id) => byId.has(id)).slice(0, 100), taskCount: load.taskIds.length, projectCount: load.projectIds.length, incompleteTaskCount: load.incompleteTaskIds.length, referencesTruncated: load.taskIds.length > 100 || load.projectIds.length > 1 || load.incompleteTaskIds.length > 100 };
    }
    const pending = await tx.aiSuggestion.findMany({ where: { projectId: input.projectId, type: "RISK", status: "PENDING" }, select: { output: true } });
    const existingSignatures = new Set(pending.map(({ output }) => warningSignature(output)));
    const suggestions = buildRiskSuggestions(findings, batchId).filter((suggestion) => !existingSignatures.has(warningSignature(suggestion.output)));
    const created: RiskSuggestion[] = [];
    for (const suggestion of suggestions) created.push(await tx.aiSuggestion.create({ data: { ...suggestion, projectId: input.projectId } }));
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: input.projectId,
      action: "AI_RISK_SUGGESTIONS_GENERATED",
      entityType: "RiskScan",
      entityId: batchId,
      after: { result: "PENDING_CONFIRMATION", ruleVersion: "2", weekStart: weekStart.toISOString(), allocation: "CALENDAR_DAYS", crossProjectTaskCount: snapshot.loadTasks.length, scannedTaskCount: tasks.length, suggestionIds: created.map((item) => item.id), findingCount: findings.length, existingPendingCount: findings.length - suggestions.length },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await notifyRiskSuggestions(tx, { actorId: input.actorId, projectId: input.projectId, recipientIds: [...recipientIds, ...(snapshot.project.ownerId ? [snapshot.project.ownerId] : [])], suggestionIds: created.map((item) => item.id) });
    return { batchId, data: created, findingCount: findings.length, scannedTaskCount: tasks.length };
}

export async function getPendingRiskWarnings(projectId: string): Promise<RiskSuggestion[]> {
  const live = await prisma.$queryRaw<{ id: string }[]>`SELECT s.id FROM AiSuggestion s WHERE s.projectId=${projectId} AND s.type='RISK' AND s.status='PENDING' AND ${liveRiskTaskClause} ORDER BY s.createdAt DESC,s.id DESC LIMIT 100`;
  const [rows, tasks] = await Promise.all([prisma.aiSuggestion.findMany({
    where: { projectId, type: "RISK", status: "PENDING", id: { in: live.map(row => row.id) } },
    select: { id: true, output: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  }), prisma.task.findMany({ where: { projectId }, select: { id: true } })]);
  const ownTaskIds = new Set(tasks.map((task) => task.id));
  // Older snapshots may contain contributor IDs from other projects.
  return rows.map((row) => {
    const output = row.output;
    if (!output || typeof output !== "object" || Array.isArray(output)) return row;
    const capacity = output.capacityEvidence;
    if (!capacity || typeof capacity !== "object" || Array.isArray(capacity)) return row;
    const localIds = (value: Prisma.JsonValue | undefined) => Array.isArray(value) ? value.filter((id) => typeof id === "string" && ownTaskIds.has(id)) : [];
    return { ...row, output: { ...output, capacityEvidence: { ...capacity, projectIds: [projectId], taskIds: localIds(capacity.taskIds), incompleteTaskIds: localIds(capacity.incompleteTaskIds) } } };
  });
}
