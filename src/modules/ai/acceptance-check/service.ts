import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getConfiguredLlm } from "../chat-model";
import { invokeModelText } from "../streaming/model";
import type { GenerationStream } from "../streaming/protocol";
import { lockBusinessActor, assertProjectAccessTx } from "@/modules/auth/project-access";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { assertCheckFresh, checkDto, currentRules } from "@/modules/projects/acceptance-check/service";
import { countsSchema, RULES } from "@/modules/projects/acceptance-check/types";
import { ACCEPTANCE_DIAGNOSIS_PROMPT } from "./prompt";
import { DiagnosisPreviewGuard, parseDiagnosis, reportText } from "./validation";
export async function generateAcceptanceDiagnosis(check: { id: string; projectId: string; actorId: string; projectVersion: number; counts: unknown; passed: boolean; fingerprint: string }, stream: GenerationStream, metadata: AuditRequestMetadata) {
  const counts = countsSchema.parse(check.counts); const context = JSON.stringify({ counts, activeRules: RULES.filter(rule => (counts[rule] ?? 0) > 0) });
  let report = reportText(counts); let degraded = false; let modelName = "deterministic-fallback"; const started = Date.now();
  const existing = await prisma.aiSuggestion.findFirst({ where: { id: check.id, projectId: check.projectId, type: "ACCEPTANCE_DIAGNOSIS" }, select: { output: true } });
  if (existing) return existing.output;
  try {
    const configured = getConfiguredLlm(); modelName = configured.modelName;
    for (let attempt = 0; attempt <= 2; attempt++) {
      stream.signal.throwIfAborted(); const guard = new DiagnosisPreviewGuard();
      if (attempt) stream.emit({ event: "progress", data: { stage: "retrying", message: "诊断内容未通过事实边界校验，正在自动修正..." } });
      const safeStream: GenerationStream = { ...stream, emit: event => { if (event.event !== "delta") stream.emit(event); else { const clean = guard.push(event.data.text); if (clean) stream.emit({ event: "delta", data: { text: clean } }); } } };
      try {
        const raw = await invokeModelText(attempt ? getConfiguredLlm({ jsonMode: true }).model : configured.model, [new SystemMessage(`${ACCEPTANCE_DIAGNOSIS_PROMPT}${attempt ? "\n只返回修正后的完整 JSON，必须严格匹配 activeRules，禁止正向结论及自行输出数字。" : ""}`), new HumanMessage(context)], safeStream, { jsonOnly: attempt > 0 });
        const parsed = parseDiagnosis(raw, counts); const tail = guard.finish(); if (tail) stream.emit({ event: "delta", data: { text: tail } }); report = reportText(counts, parsed.sections); break;
      } catch (error) { stream.signal.throwIfAborted(); if (!(error instanceof SyntaxError || error instanceof ZodError) || attempt === 2) throw error; }
    }
  } catch { stream.signal.throwIfAborted(); degraded = true; stream.emit({ event: "progress", data: { stage: "fallback", message: "AI 诊断暂不可用，已保留数据库核验的缺口和整改指引" } }); }
  stream.signal.throwIfAborted();
  return prisma.$transaction(async tx => {
    stream.signal.throwIfAborted(); await lockBusinessActor(tx, check.actorId, ["PM", "ADMIN"], check.projectId); await assertProjectAccessTx(tx, check.actorId, check.projectId);
    const project = await tx.project.findUniqueOrThrow({ where: { id: check.projectId } });
    await assertCheckFresh(tx, check.projectId, check.id, check.actorId, await currentRules(tx, check.projectId), project.rowVersion);
    const prior = await tx.aiSuggestion.findFirst({ where: { id: check.id, projectId: check.projectId, type: "ACCEPTANCE_DIAGNOSIS" } }); if (prior) return prior.output;
    const payload = { ...checkDto(check), report, degraded };
    await tx.aiSuggestion.create({ data: { id: check.id, projectId: check.projectId, type: "ACCEPTANCE_DIAGNOSIS", input: { checkId: check.id, fingerprint: check.fingerprint, model: modelName, durationMs: Date.now() - started }, output: payload } });
    await recordAudit(tx, { actorId: check.actorId, projectId: check.projectId, ...metadata, action: "AI_ACCEPTANCE_DIAGNOSIS_GENERATED", entityType: "AiSuggestion", entityId: check.id, after: { checkId: check.id, fingerprint: check.fingerprint, model: modelName, degraded, durationMs: Date.now() - started } });
    stream.signal.throwIfAborted(); return payload;
  }, { timeout: 15000 });
}
