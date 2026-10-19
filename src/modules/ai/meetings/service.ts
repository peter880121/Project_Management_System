import { randomUUID } from "node:crypto";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { lockAssetActor } from "@/modules/assets/services";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { getConfiguredLlm } from "@/modules/ai/chat-model";
import { ProjectError } from "@/modules/projects/services";
import { invokeModelText } from "../streaming/model";
import { assertCleanGeneratedValue, cleanGeneratedValue } from "../streaming/clean-text";
import type { GenerationStream } from "../streaming/protocol";
import { MEETING_REPAIR_PROMPT, MEETING_SUMMARY_PROMPT } from "./prompt";
import { assertDraft, contentSha, loadMeetingTx } from "./repository";
import { summarySchema, summaryResultSchema, transcriptFits, TOO_LONG_MESSAGE, type MeetingSummaryResult } from "./types";

export class MeetingStructureError extends ProjectError { constructor() { super("AI 未能生成标准会议结构，请精简描述或手动整理。", 422); } }
export function parseMeetingOutput(raw: string, memberIds: Set<string>) {
  const value = cleanGeneratedValue(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  assertCleanGeneratedValue(value);
  const result = summarySchema.parse(value);
  if (result.actionItems.some(item => item.suggestedAssigneeId && !memberIds.has(item.suggestedAssigneeId))) throw new SyntaxError("Unknown suggested member");
  return result;
}
// Retry only malformed structure. Provider/network failures must not cause duplicate paid calls.
export async function generateMeetingOutput(invoke: (attempt: number) => Promise<string>, stream: GenerationStream, memberIds: Set<string>) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    stream.signal.throwIfAborted();
    if (attempt) stream.emit({ event: "progress", data: { stage: "retrying", message: "输出格式校验未通过，正在自动修正..." } });
    try { const raw = await invoke(attempt); stream.signal.throwIfAborted(); return parseMeetingOutput(raw, memberIds); }
    catch (error) { stream.signal.throwIfAborted(); if (!(error instanceof SyntaxError || error instanceof ZodError)) throw error; if (attempt === 2) throw new MeetingStructureError(); }
  }
  throw new MeetingStructureError();
}
export async function meetingContext(projectId: string, meetingId: string, actorId: string, expectedVersion: number) {
  return prisma.$transaction(async tx => {
    const actor = await lockAssetActor(tx, projectId, { actorId }, ["PM"]);
    const meeting = await loadMeetingTx(tx, projectId, meetingId, actor.role); assertDraft(meeting, expectedVersion);
    const members = await tx.user.findMany({ where: { status: "ACTIVE", isSystem: false, OR: [{ ownedProjects: { some: { id: projectId } } }, { projectMemberships: { some: { projectId, active: true } } }] }, select: { id: true, name: true }, take: 101 });
    if (members.length > 100) throw new ProjectError("项目成员过多，请手动整理负责人", 422);
    return { meeting, members };
  });
}
export async function summarizeMeeting(input: { projectId: string; meetingId: string; actorId: string; text: string; expectedVersion: number } & AuditRequestMetadata, stream: GenerationStream): Promise<MeetingSummaryResult> {
  const context = await meetingContext(input.projectId, input.meetingId, input.actorId, input.expectedVersion);
  const data = { meetingDate: context.meeting.meetingDate.toISOString(), timezone: "Asia/Hong_Kong", title: context.meeting.title, members: context.members, transcript: input.text };
  const contextTokens = Number(process.env.AI_CONTEXT_WINDOW_TOKENS || 32000);
  if (!Number.isFinite(contextTokens) || contextTokens < 1000 || !transcriptFits(input.text, contextTokens, JSON.stringify({ ...data, transcript: "" }).length + MEETING_SUMMARY_PROMPT.length)) throw new ProjectError(TOO_LONG_MESSAGE, 413);
  const configured = getConfiguredLlm(); const started = Date.now();
  const messages = [new SystemMessage(MEETING_SUMMARY_PROMPT), new HumanMessage(JSON.stringify(data))];
  stream.emit({ event: "progress", data: { stage: "summarizing", message: "正在提炼摘要与行动项，结果需要人工确认" } });
  const result = await generateMeetingOutput(attempt => invokeModelText(attempt ? getConfiguredLlm({ jsonMode: true }).model : configured.model, attempt ? [new SystemMessage(`${MEETING_SUMMARY_PROMPT}\n${MEETING_REPAIR_PROMPT}`), messages[1]] : messages, stream, { jsonOnly: attempt > 0 }), stream, new Set(context.members.map(member => member.id))).catch(async error => {
    stream.signal.throwIfAborted();
    const code = error instanceof MeetingStructureError ? "MODEL_RESPONSE_INVALID" : "MODEL_REQUEST_FAILED";
    try {
      await prisma.$transaction(tx => recordAudit(tx, { ...input, action: "AI_MEETING_GENERATION_FAILED", entityType: "AiGeneration", entityId: stream.generationId, after: { meetingId: input.meetingId, code, model: configured.modelName, durationMs: Date.now() - started, transcriptSha256: contentSha(input.text) } }));
    } catch { console.warn("AI_MEETING_FAILURE_AUDIT_UNAVAILABLE", { generationId: stream.generationId }); }
    throw error;
  });
  stream.signal.throwIfAborted();
  return prisma.$transaction(async tx => {
    stream.signal.throwIfAborted();
    const actor = await lockAssetActor(tx, input.projectId, input, ["PM"]);
    const meeting = await loadMeetingTx(tx, input.projectId, input.meetingId, actor.role); assertDraft(meeting, input.expectedVersion);
    const existing = await tx.aiSuggestion.findUnique({ where: { id: stream.generationId } });
    if (existing) throw new ProjectError("生成请求已提交，请刷新待确认建议", 409);
    const payload = summaryResultSchema.parse({ suggestionId: stream.generationId, meetingId: meeting.id, meetingVersion: meeting.rowVersion, summary: result.summary, actionItems: result.actionItems.map(item => ({ ...item, id: randomUUID(), checked: false, suggestionId: stream.generationId })) });
    await tx.aiSuggestion.create({ data: { id: stream.generationId, projectId: input.projectId, type: "MEETING_SUMMARY", input: { meetingId: meeting.id, rowVersion: meeting.rowVersion, actorId: input.actorId, contentSha256: contentSha(meeting.content), titleSha256: contentSha(meeting.title), meetingDate: meeting.meetingDate.toISOString(), transcriptSha256: contentSha(input.text), model: configured.modelName, durationMs: Date.now() - started }, output: payload } });
    await recordAudit(tx, { ...input, action: "AI_MEETING_GENERATED", entityType: "AiSuggestion", entityId: payload.suggestionId, after: { meetingId: meeting.id, model: configured.modelName, durationMs: Date.now() - started, transcriptSha256: contentSha(input.text), actionItemCount: payload.actionItems.length } });
    stream.signal.throwIfAborted();
    return payload;
  });
}
