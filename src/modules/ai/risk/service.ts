import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { analyzeProjectRisks, type RiskFinding, type RiskTask } from "./rules";

export type RiskSuggestion = { id: string; output: Prisma.JsonValue; createdAt: Date };

export function buildRiskSuggestions(findings: RiskFinding[], batchId: string) {
  return findings.map((finding) => ({
    id: randomUUID(),
    type: "RISK" as const,
    status: "PENDING" as const,
    input: { batchId, ruleVersion: "1", taskId: finding.taskId },
    output: {
      taskId: finding.taskId,
      taskTitle: finding.taskTitle,
      severity: finding.severity,
      evidence: finding.evidence,
      relatedTaskIds: finding.relatedTaskIds,
      historicalDelayRate: finding.historicalDelayRate,
      historySampleSize: finding.historySampleSize,
    } satisfies Prisma.InputJsonValue,
  }));
}

export async function generateProjectRiskWarnings(input: { projectId: string; actorId: string; now?: Date } & AuditRequestMetadata) {
  const batchId = randomUUID();
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    if (!project) throw new Error("Project not found");
    const rows = await tx.task.findMany({
      where: { projectId: input.projectId },
      select: {
        id: true, title: true, status: true, dueDate: true, completedAt: true,
        assignee: { select: { id: true, name: true } },
        dependencies: { where: { dependsOn: { projectId: input.projectId } }, select: { dependsOn: { select: { id: true, title: true, status: true } } } },
      },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: 2000,
    });
    const tasks: RiskTask[] = rows.map((task) => ({ ...task, dependencies: task.dependencies.map(({ dependsOn }) => dependsOn) }));
    const findings = analyzeProjectRisks(tasks, input.now);
    const pending = await tx.aiSuggestion.findMany({ where: { projectId: input.projectId, type: "RISK", status: "PENDING" }, select: { output: true } });
    const existingTaskIds = new Set(pending.flatMap(({ output }) => {
      if (!output || Array.isArray(output) || typeof output !== "object") return [];
      return typeof output.taskId === "string" ? [output.taskId] : [];
    }));
    const suggestions = buildRiskSuggestions(findings.filter((finding) => !existingTaskIds.has(finding.taskId)), batchId);
    const created: RiskSuggestion[] = [];
    for (const suggestion of suggestions) created.push(await tx.aiSuggestion.create({ data: { ...suggestion, projectId: input.projectId } }));
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: input.projectId,
      action: "AI_RISK_SUGGESTIONS_GENERATED",
      entityType: "RiskScan",
      entityId: batchId,
      after: { result: "PENDING_CONFIRMATION", scannedTaskCount: tasks.length, suggestionIds: created.map((item) => item.id), findingCount: findings.length, existingPendingCount: findings.length - suggestions.length },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { batchId, data: created, findingCount: findings.length, scannedTaskCount: tasks.length };
  });
}

export async function getPendingRiskWarnings(projectId: string): Promise<RiskSuggestion[]> {
  return prisma.aiSuggestion.findMany({
    where: { projectId, type: "RISK", status: "PENDING" },
    select: { id: true, output: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
}
