import { randomUUID } from "node:crypto";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
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
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = complianceSummarySchema.parse(JSON.parse(unfenced.slice(unfenced.indexOf("{"), unfenced.lastIndexOf("}") + 1)));
  const audits = new Set(data.auditLogs.map((row) => row.id));
  const records = new Set([...data.tasks, ...data.requirements, ...data.testCases].map((row) => row.id));
  for (const item of [...parsed.keyChanges, ...parsed.anomalies, ...parsed.reviewItems]) {
    if (item.auditIds.some((id) => !audits.has(id))) throw new Error("Unknown audit reference");
  }
  for (const item of [...parsed.anomalies, ...parsed.reviewItems]) if (item.recordIds.some((id) => !records.has(id))) throw new Error("Unknown record reference");
  return parsed;
}
export async function summarizeCompliance(data: ComplianceAuditInput, invoke: (input: string) => Promise<string>): Promise<ComplianceAuditResult> {
  const findings = findTraceabilityIssues(data);
  try {
    // Bound model context only; retain every rule finding in the persisted result.
    const summary = parseSummary(await invoke(JSON.stringify({ auditLogIds: data.auditLogs.map((row) => row.id), recordIds: [...data.tasks, ...data.requirements, ...data.testCases].slice(0, 500).map((row) => row.id), auditLogs: data.auditLogs, deterministicFindings: findings.slice(0, 30), totalFindingCount: findings.length })), data);
    return { summary, findings, auditLogs: data.auditLogs, degraded: false };
  } catch {
    return { summary: { overview: "语言模型不可用，已保留规则发现和原始审计记录。", keyChanges: [], anomalies: [], reviewItems: [] }, findings, auditLogs: data.auditLogs, degraded: true };
  }
}
async function invokeWithTimeout(model: BaseChatModel, input: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      model.invoke([new SystemMessage(COMPLIANCE_AUDIT_SYSTEM_PROMPT), new HumanMessage(input)]),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Model timeout")), 30000); }),
    ]);
    if (typeof response.content === "string") return response.content;
    return response.content.map((part) => typeof part === "string" ? part : "text" in part ? String(part.text) : "").join("");
  } finally { if (timer) clearTimeout(timer); }
}
export async function runComplianceAudit(input: ScanFilters & { actorId: string } & AuditRequestMetadata) {
  await prisma.$transaction(tx => lockBusinessActor(tx, input.actorId, input.taskId ? ["ADMIN", "QA", "PM"] : ["ADMIN", "QA"], input.projectId));
  const scannedAt = new Date().toISOString();
  const { data, coverage } = await loadComplianceSnapshot(input);
  let modelName = "unavailable";
  let result: ComplianceAuditResult;
  try {
    const configured = getConfiguredLlm(); modelName = `${configured.provider}:${configured.modelName}`;
    result = await summarizeCompliance(data, (prompt) => invokeWithTimeout(configured.model, prompt));
  } catch { result = await summarizeCompliance(data, async () => { throw new Error("LLM unavailable"); }); }
  const summaryId = randomUUID();
  const filters = { projectId: input.projectId, taskId: input.taskId ?? null, actorId: input.actorFilter ?? null, from: input.from?.toISOString() ?? null, to: input.to?.toISOString() ?? null };
  const output = { ...result, model: modelName, coverage, scannedAt };
  // JSON round-trip converts snapshot dates for Prisma's JSON columns.
  const snapshot = JSON.parse(JSON.stringify({ filters, ruleVersion: RULE_VERSION, scannedAt, coverage, snapshot: data }));
  const jsonOutput = JSON.parse(JSON.stringify(output));
  await prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, input.actorId, input.taskId ? ["ADMIN", "QA", "PM"] : ["ADMIN", "QA"], input.projectId);
    if (input.taskId) {
      const current = await loadAiTask(input.projectId, input.taskId, "compliance", tx);
      if (current.updatedAt.getTime() !== data.tasks[0]?.updatedAt.getTime()) throw new ProjectError("任务已更新，请重新检查证据", 409);
    }
    await insertSummary(tx, { id: summaryId, projectId: input.projectId, type: "AUDIT_SUMMARY", status: "PENDING", input: snapshot, output: jsonOutput });
    await recordAudit(tx, { actorId: input.actorId, projectId: input.projectId, action: "AI_AUDIT_SUMMARY_GENERATED", entityType: "AuditSummary", entityId: summaryId, after: { filters, ruleVersion: RULE_VERSION, coverage, sourceAuditIds: data.auditLogs.map((row) => row.id), result: result.degraded ? "RULE_BASED_FALLBACK" : "AI_SUMMARY", status: "PENDING", findingCount: result.findings.length, summary: result.summary, model: modelName }, ip: input.ip, userAgent: input.userAgent });
  });
  return { ...output, summaryId, status: "PENDING" as const };
}
