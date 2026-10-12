import { randomUUID } from "node:crypto";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getConfiguredLlm } from "@/modules/ai/chat-model";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { COMPLIANCE_AUDIT_SYSTEM_PROMPT } from "./prompt";
import { complianceSummarySchema, type ComplianceAuditInput, type ComplianceAuditResult, type ComplianceFinding, type ComplianceSummary } from "./types";

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("Model response was not text");
  return content.map((part) => typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "").join("");
}

export function findTraceabilityIssues(data: ComplianceAuditInput): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  const latestTaskAudit = new Map<string, string>();
  for (const log of data.auditLogs) if (log.entityType === "Task" && !latestTaskAudit.has(log.entityId)) latestTaskAudit.set(log.entityId, log.id);
  const latestRequirementAudit = new Map<string, string>();
  for (const log of data.auditLogs) if (log.entityType === "Requirement" && !latestRequirementAudit.has(log.entityId)) latestRequirementAudit.set(log.entityId, log.id);
  const requirements = new Map(data.requirements.map((item) => [item.id, item]));
  const casesByRequirement = new Map<string, typeof data.testCases>();
  for (const testCase of data.testCases) casesByRequirement.set(testCase.requirementId, [...(casesByRequirement.get(testCase.requirementId) ?? []), testCase]);

  for (const task of data.tasks) {
    if (task.status !== "DONE" || !task.requirementId) continue;
    const cases = casesByRequirement.get(task.requirementId) ?? [];
    if (cases.length === 0 || cases.some((item) => item.status !== "PASSED")) {
      const requirement = requirements.get(task.requirementId);
      const auditIds = [latestTaskAudit.get(task.id), latestRequirementAudit.get(task.requirementId)].filter((id): id is string => Boolean(id));
      findings.push({
        summary: cases.length === 0 ? `已完成任务 ${task.id} 关联的需求暂无测试用例，需复核追溯完整性。` : `已完成任务 ${task.id} 关联需求仍有未通过测试用例，需复核后再确认交付。`,
        auditIds,
        recordIds: [task.id, task.requirementId, ...(requirement ? [requirement.id] : []), ...cases.filter((item) => item.status !== "PASSED").map((item) => item.id)],
      });
    }
  }

  for (const requirement of data.requirements) {
    const linkedTasks = data.tasks.filter((task) => task.requirementId === requirement.id);
    if (linkedTasks.some((task) => task.updatedAt < requirement.updatedAt)) {
      const auditIds = [latestRequirementAudit.get(requirement.id), ...linkedTasks.map((task) => latestTaskAudit.get(task.id))].filter((id): id is string => Boolean(id));
      findings.push({ summary: `需求 ${requirement.id} 的更新时间晚于至少一个关联任务，可能需要确认任务内容是否同步。`, auditIds, recordIds: [requirement.id, ...linkedTasks.filter((task) => task.updatedAt < requirement.updatedAt).map((task) => task.id)] });
    }
  }
  return findings;
}

function parseSummary(raw: string, allowedAuditIds: Set<string>, allowedRecordIds: Set<string>): ComplianceSummary {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model response did not contain JSON");
  const parsed = complianceSummarySchema.parse(JSON.parse(unfenced.slice(start, end + 1)));
  for (const item of [...parsed.keyChanges, ...parsed.anomalies, ...parsed.reviewItems]) {
    if (item.auditIds.some((id) => !allowedAuditIds.has(id))) throw new Error("Model referenced an unknown audit record");
  }
  for (const item of [...parsed.anomalies, ...parsed.reviewItems]) {
    if (item.recordIds.some((id) => !allowedRecordIds.has(id))) throw new Error("Model referenced an unknown business record");
  }
  return parsed;
}

function fallbackSummary(findings: ComplianceFinding[], auditCount: number): ComplianceSummary {
  return {
    overview: `已检查 ${auditCount} 条审计记录；语言模型不可用，以下为规则扫描结果。`,
    keyChanges: [],
    anomalies: findings,
    reviewItems: auditCount ? [{ summary: "请人工检查本次范围内的原始审计记录，规则扫描不能替代合规复核。", auditIds: [], recordIds: [] }] : [],
  };
}

export async function summarizeCompliance(
  data: ComplianceAuditInput,
  invoke: (input: string) => Promise<string>,
): Promise<ComplianceAuditResult> {
  const findings = findTraceabilityIssues(data);
  const allowedAuditIds = new Set(data.auditLogs.map((log) => log.id));
  const recordIds = [...data.tasks.map((item) => item.id), ...data.requirements.map((item) => item.id), ...data.testCases.map((item) => item.id)];
  const allowedRecordIds = new Set(recordIds);
  try {
    const summary = parseSummary(await invoke(JSON.stringify({ auditLogIds: [...allowedAuditIds], recordIds, auditLogs: data.auditLogs.map((log) => ({ ...log, createdAt: log.createdAt.toISOString() })), deterministicFindings: findings })), allowedAuditIds, allowedRecordIds);
    return { summary, auditLogs: data.auditLogs, degraded: false };
  } catch {
    return { summary: fallbackSummary(findings, data.auditLogs.length), auditLogs: data.auditLogs, degraded: true };
  }
}

async function invokeWithTimeout(model: BaseChatModel, input: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      model.invoke([new SystemMessage(COMPLIANCE_AUDIT_SYSTEM_PROMPT), new HumanMessage(input)]),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Model timeout")), 30_000); }),
    ]);
    return extractText(response.content);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runComplianceAudit(input: {
  projectId: string;
  actorId: string;
  actorFilter?: string;
  from?: Date;
  to?: Date;
  ip?: string | null;
  userAgent?: string | null;
} & AuditRequestMetadata): Promise<ComplianceAuditResult & { summaryId: string }> {
  const range = input.from || input.to ? { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } : undefined;
  const auditLogs = await prisma.auditLog.findMany({
    where: { projectId: input.projectId, ...(input.actorFilter ? { actorId: input.actorFilter } : {}), ...(range ? { createdAt: range } : {}) },
    select: { id: true, action: true, entityType: true, entityId: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
  });
  const data = await prisma.$transaction(async (tx) => {
    const [tasks, requirements] = await Promise.all([
      tx.task.findMany({ where: { projectId: input.projectId }, select: { id: true, status: true, requirementId: true, updatedAt: true }, take: 500 }),
      tx.requirement.findMany({ where: { projectId: input.projectId }, select: { id: true, updatedAt: true }, take: 500 }),
    ]);
    const requirementIds = [...new Set([...requirements.map((item) => item.id), ...tasks.flatMap((item) => item.requirementId ? [item.requirementId] : [])])];
    const testCases = requirementIds.length ? await tx.testCase.findMany({ where: { requirementId: { in: requirementIds } }, select: { id: true, requirementId: true, status: true }, take: 1000 }) : [];
    return { auditLogs, tasks, requirements, testCases } satisfies ComplianceAuditInput;
  });

  let result: ComplianceAuditResult;
  try {
    const { model } = getConfiguredLlm();
    result = await summarizeCompliance(data, (prompt) => invokeWithTimeout(model, prompt));
  } catch {
    result = await summarizeCompliance(data, async () => { throw new Error("LLM unavailable"); });
  }
  const summaryId = randomUUID();
  await prisma.$transaction((tx) => recordAudit(tx, {
    actorId: input.actorId,
    projectId: input.projectId,
    action: "AI_AUDIT_SUMMARY_GENERATED",
    entityType: "AuditSummary",
    entityId: summaryId,
    after: {
      filters: { projectId: input.projectId, actorId: input.actorFilter ?? null, from: input.from?.toISOString() ?? null, to: input.to?.toISOString() ?? null },
      sourceAuditIds: data.auditLogs.map((log) => log.id),
      result: result.degraded ? "RULE_BASED_FALLBACK" : "AI_SUMMARY",
      findingCount: result.summary.anomalies.length + result.summary.reviewItems.length,
      summary: result.summary,
    } satisfies Prisma.InputJsonValue,
    ip: input.ip,
    userAgent: input.userAgent,
  }));
  return { ...result, summaryId };
}
