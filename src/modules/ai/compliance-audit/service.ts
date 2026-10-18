import { cleanGeneratedValue, assertCleanGeneratedValue, assertNoControlMarkers } from "../streaming/clean-text";
import { randomUUID } from "node:crypto";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeModelText } from "../streaming/model";
import type { GenerationStream } from "../streaming/protocol";
import { prisma } from "@/lib/prisma";
import { lockBusinessActor } from "@/modules/auth/project-access";
import { getConfiguredLlm } from "@/modules/ai/chat-model";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { COMPLIANCE_AUDIT_SYSTEM_PROMPT } from "./prompt";
import { complianceSummarySchema, type ComplianceAuditInput, type ComplianceAuditResult, type ComplianceSummary } from "./types";
import { findTraceabilityIssues, RULE_VERSION } from "./rules";
import { insertSummary, loadComplianceSnapshot, type ScanFilters } from "./repositories";
import { loadAiTask } from "../task-context";
import { ProjectError } from "@/modules/projects/services";
export { findTraceabilityIssues } from "./rules";

function parseSummary(raw: string, data: ComplianceAuditInput): ComplianceSummary {
  const unfenced = String(cleanGeneratedValue(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  const cleaned = cleanGeneratedValue(JSON.parse(unfenced.slice(unfenced.indexOf("{"), unfenced.lastIndexOf("}") + 1)));
  assertCleanGeneratedValue(cleaned);
  const parsed = complianceSummarySchema.parse(cleaned);
  const audits = new Set(data.auditLogs.map((row) => row.id));
  const records = new Set([...data.tasks, ...data.requirements, ...data.testCases].map((row) => row.id));
  for (const item of [...parsed.keyChanges, ...parsed.anomalies, ...parsed.reviewItems]) {
    if (item.auditIds.some((id) => !audits.has(id))) throw new Error("Unknown audit reference");
  }
  for (const item of [...parsed.anomalies, ...parsed.reviewItems]) if (item.recordIds.some((id) => !records.has(id))) throw new Error("Unknown record reference");
  return parsed;
}
export async function summarizeCompliance(data: ComplianceAuditInput, invoke: (input: string) => Promise<string>, signal?: AbortSignal): Promise<ComplianceAuditResult> {
  const findings = findTraceabilityIssues(data);
  try {
    // Bound model context only; retain every rule finding in the persisted result.
    const summary = parseSummary(await invoke(JSON.stringify({ auditLogIds: data.auditLogs.map((row) => row.id), recordIds: [...data.tasks, ...data.requirements, ...data.testCases].slice(0, 500).map((row) => row.id), auditLogs: data.auditLogs, deterministicFindings: findings.slice(0, 30), totalFindingCount: findings.length })), data);
    return { summary, findings, auditLogs: data.auditLogs, degraded: false };
  } catch {
    signal?.throwIfAborted();
    return { summary: { overview: "语言模型不可用，已保留规则发现和原始审计记录。", keyChanges: [], anomalies: [], reviewItems: [] }, findings, auditLogs: data.auditLogs, degraded: true };
  }
}
export async function runComplianceAudit(input: ScanFilters & { actorId: string } & AuditRequestMetadata, stream?: GenerationStream) {
  await prisma.$transaction(tx => lockBusinessActor(tx, input.actorId, input.taskId ? ["ADMIN", "QA", "PM"] : ["ADMIN", "QA"], input.projectId));
  stream?.signal.throwIfAborted();
  stream?.emit({ event: "progress", data: { stage: "checking", message: "正在扫描需求、任务、测试和审计证据" } });
  const scannedAt = new Date().toISOString();
  const { data, coverage } = await loadComplianceSnapshot(input);
  stream?.signal.throwIfAborted();
  let modelName = "unavailable";
  let result: ComplianceAuditResult;
  try {
    const configured = getConfiguredLlm(); modelName = `${configured.provider}:${configured.modelName}`;
    result = await summarizeCompliance(data, (prompt) => invokeModelText(configured.model, [new SystemMessage(COMPLIANCE_AUDIT_SYSTEM_PROMPT), new HumanMessage(prompt)], stream), stream?.signal);
  } catch { stream?.signal.throwIfAborted(); result = await summarizeCompliance(data, async () => { throw new Error("LLM unavailable"); }); }
  stream?.signal.throwIfAborted();
  stream?.emit({ event: "progress", data: { stage: "validating", message: "正在校验合规摘要及引用来源" } });
  const summaryId = stream?.generationId ?? randomUUID();
  const filters = { projectId: input.projectId, taskId: input.taskId ?? null, actorId: input.actorFilter ?? null, from: input.from?.toISOString() ?? null, to: input.to?.toISOString() ?? null };
  const output = { ...result, model: modelName, coverage, scannedAt };
  // JSON round-trip converts snapshot dates for Prisma's JSON columns.
  const snapshot = JSON.parse(JSON.stringify({ filters, ...(stream ? { generationId: stream.generationId } : {}), ruleVersion: RULE_VERSION, scannedAt, coverage, snapshot: data }));
  const jsonOutput = JSON.parse(JSON.stringify(output));
  assertNoControlMarkers({ snapshot, output: jsonOutput });
  await prisma.$transaction(async (tx) => {
    stream?.signal.throwIfAborted();
    await lockBusinessActor(tx, input.actorId, input.taskId ? ["ADMIN", "QA", "PM"] : ["ADMIN", "QA"], input.projectId);
    if (input.taskId) {
      const current = await loadAiTask(input.projectId, input.taskId, "compliance", tx);
      if (current.updatedAt.getTime() !== data.tasks[0]?.updatedAt.getTime()) throw new ProjectError("任务已更新，请重新检查证据", 409);
    }
    stream?.signal.throwIfAborted();
    await insertSummary(tx, { id: summaryId, projectId: input.projectId, type: "AUDIT_SUMMARY", status: "PENDING", input: snapshot, output: jsonOutput });
    await recordAudit(tx, { actorId: input.actorId, projectId: input.projectId, action: "AI_AUDIT_SUMMARY_GENERATED", entityType: "AuditSummary", entityId: summaryId, after: { filters, ruleVersion: RULE_VERSION, coverage, sourceAuditIds: data.auditLogs.map((row) => row.id), result: result.degraded ? "RULE_BASED_FALLBACK" : "AI_SUMMARY", status: "PENDING", findingCount: result.findings.length, summary: result.summary, model: modelName }, ip: input.ip, userAgent: input.userAgent });
    stream?.signal.throwIfAborted();
  });
  return { ...output, summaryId, status: "PENDING" as const };
}
