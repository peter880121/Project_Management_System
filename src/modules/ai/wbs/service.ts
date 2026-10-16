import { randomUUID } from "node:crypto";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockBusinessActor } from "@/modules/auth/project-access";
import { recordAudit, recordRagSearch } from "@/modules/audit/service";
import type { AuditRequestMetadata } from "@/modules/audit/service";
import { getConfiguredLlm } from "@/modules/ai/chat-model";
import { retrieveHistoricalTasks, type HistoryRetrieval } from "./history";
import { searchProjectDocuments } from "@/modules/documents/rag-service";
import { WBS_SYSTEM_PROMPT, WBS_DOCUMENT_INSTRUCTIONS } from "./prompt";
import { wbsResponseSchema, type WbsResponse, type WbsDocumentEvidence } from "./types";

export type WbsGenerationInput = {
  projectId: string;
  actorId: string;
  request: string;
} & AuditRequestMetadata;

export type WbsGenerationResult = Readonly<{
  suggestions: { id: string; output: Prisma.JsonValue }[];
  historicalTasks: HistoryRetrieval["tasks"];
  documentEvidence: WbsDocumentEvidence[];
  degraded: boolean;
  model: string;
  modelDurationMs: number;
  manualFallback: boolean;
}>;

export function summarizeWbsInput(request: string): string {
  return request
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-number]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 320);
}

export function containsLikelySensitiveInput(request: string): boolean {
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(request) ||
    /\+?\d[\d\s().-]{8,}\d/.test(request) ||
    /(?:患者(?:姓名|身份证|病历号|病案号|电话|出生日期)|patient\s*(?:name|id|dob|date of birth)|medical record number|\bMRN\b)\s*[:：=]\s*\S+/i.test(request);
}

export function parseWbsResponse(raw: string): WbsResponse {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model response did not contain a JSON object");
  return wbsResponseSchema.parse(JSON.parse(unfenced.slice(start, end + 1)));
}

export async function invokeWbsModel(
  request: string,
  historicalTasks: HistoryRetrieval["tasks"],
  invoke: (prompt: string) => Promise<string>,
  documentEvidence: WbsDocumentEvidence[] = [],
): Promise<WbsResponse> {
  const context = JSON.stringify({ request, completedTaskHistory: historicalTasks.map((task) => ({
    title: task.title,
    description: task.description,
    actualHours: task.actualHours,
    deliveryDays: task.deliveryDays,
  })), documentEvidence });
  const response = parseWbsResponse(await invoke(context));
  const allowed = new Set(documentEvidence.map((source) => source.id));
  if (response.tasks.some((task) => task.sourceChunkIds.some((id) => !allowed.has(id)))) throw new Error("Model cited a document chunk outside the supplied evidence");
  return response;
}

export async function generateOrEmpty(
  request: string,
  historicalTasks: HistoryRetrieval["tasks"],
  invoke: (prompt: string) => Promise<string>,
  documentEvidence: WbsDocumentEvidence[] = [],
): Promise<{ tasks: WbsResponse["tasks"]; error?: string }> {
  try {
    return { tasks: (await invokeWbsModel(request, historicalTasks, invoke, documentEvidence)).tasks };
  } catch (error) {
    return { tasks: [], error: error instanceof Error ? error.message : "LLM request failed" };
  }
}

function messageText(messageContent: unknown): string {
  if (typeof messageContent === "string") return messageContent;
  if (!Array.isArray(messageContent)) throw new Error("Model response was not text");
  return messageContent.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
    return "";
  }).join("");
}

async function saveGenerationFailure(input: WbsGenerationInput, batchId: string, summary: string, model: string, durationMs: number, reason: string) {
  await prisma.$transaction((tx) => recordAudit(tx, {
    actorId: input.actorId,
    projectId: input.projectId,
    action: "AI_WBS_GENERATION_FAILED",
    entityType: "WbsGeneration",
    entityId: batchId,
    after: { inputSummary: summary, model, durationMs, result: "MANUAL_TASK_CREATION", reason: reason.slice(0, 300) },
    ip: input.ip,
    userAgent: input.userAgent,
  }));
}

async function invokeWithTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Model request timed out")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function generateWbsSuggestions(input: WbsGenerationInput): Promise<WbsGenerationResult> {
  const batchId = randomUUID();
  const summary = summarizeWbsInput(input.request);
  const [retrieval, documents] = await Promise.all([
    retrieveHistoricalTasks(input.projectId, summary),
    searchProjectDocuments(input.projectId, { query: summary, limit: 4 }, { actorId: input.actorId, ip: input.ip, userAgent: input.userAgent }),
  ]);
  const documentEvidence: WbsDocumentEvidence[] = documents.hits.map(({ id, documentId, version, page, text, textSha256, filename }) => ({ id, documentId, version, page, text, textSha256, filename }));
  const degraded = retrieval.degraded || documents.degraded;
  await recordRagSearch({
    actorId: input.actorId,
    projectId: input.projectId,
    query: summary,
    hitIds: retrieval.hitIds,
    durationMs: retrieval.durationMs,
    degraded: retrieval.degraded,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  let configuredProvider = process.env.AI_PROVIDER || "openai";
  let configuredModel = process.env.AI_MODEL || "unconfigured";
  let model: BaseChatModel;
  try {
    const configured = getConfiguredLlm();
    configuredProvider = configured.provider;
    configuredModel = configured.modelName;
    model = configured.model;
  } catch {
    const reason = "LLM_CONFIGURATION_MISSING_OR_INVALID";
    await saveGenerationFailure(input, batchId, summary, `${configuredProvider}:${configuredModel}`, 0, reason);
    return { suggestions: [], historicalTasks: retrieval.tasks, documentEvidence, degraded, model: `${configuredProvider}:${configuredModel}`, modelDurationMs: 0, manualFallback: true };
  }

  const modelStartedAt = Date.now();
  const generated = await generateOrEmpty(input.request, retrieval.tasks, async (context) => {
    const response = await invokeWithTimeout(model.invoke([
      new SystemMessage(`${WBS_SYSTEM_PROMPT}\n${WBS_DOCUMENT_INSTRUCTIONS}`),
      new HumanMessage(context),
    ]), 30_000);
    return messageText(response.content);
  }, documentEvidence);
  if (generated.error) {
    const durationMs = Date.now() - modelStartedAt;
    await saveGenerationFailure(input, batchId, summary, `${configuredProvider}:${configuredModel}`, durationMs, "LLM_REQUEST_OR_RESPONSE_VALIDATION_FAILED");
    return { suggestions: [], historicalTasks: retrieval.tasks, documentEvidence, degraded, model: `${configuredProvider}:${configuredModel}`, modelDurationMs: durationMs, manualFallback: true };
  }
  const tasks = generated.tasks;
  const modelDurationMs = Date.now() - modelStartedAt;
  const suggestionIds = tasks.map(() => randomUUID());
  const suggestionsData = tasks.map((task, index) => ({
    id: suggestionIds[index],
    projectId: input.projectId,
    type: "WBS" as const,
    status: "PENDING" as const,
    input: {
      batchId,
      inputSummary: summary,
      model: `${configuredProvider}:${configuredModel}`,
      retrievalHitIds: retrieval.hitIds,
      retrievalDegraded: retrieval.degraded,
      retrievalDurationMs: retrieval.durationMs,
      modelDurationMs,
      documentEvidence,
      documentRetrieval: { hitIds: documents.hitIds, degraded: documents.degraded, mode: documents.mode, reason: documents.reason, durationMs: documents.durationMs },
    },
    output: {
      title: task.title,
      description: task.description,
      estimateHours: task.estimateHours,
      suggestedRole: task.suggestedRole,
      sourceChunkIds: task.sourceChunkIds,
      dependencyIds: task.dependencies.map((dependencyIndex) => suggestionIds[dependencyIndex]),
      dependencyTitles: task.dependencies.map((dependencyIndex) => tasks[dependencyIndex]?.title).filter((title): title is string => Boolean(title)),
    },
  }));

  const saved = await prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, input.actorId, ["PM"], input.projectId);
    const suggestions = await Promise.all(suggestionsData.map((data) => tx.aiSuggestion.create({ data })));
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: input.projectId,
      action: "AI_WBS_GENERATED",
      entityType: "WbsGeneration",
      entityId: batchId,
      after: { inputSummary: summary, model: `${configuredProvider}:${configuredModel}`, durationMs: modelDurationMs, retrievalHitIds: retrieval.hitIds, documentHitIds: documents.hitIds, degraded, suggestionIds: suggestions.map((suggestion) => suggestion.id), result: "PENDING_CONFIRMATION" },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return suggestions.map((suggestion) => ({ id: suggestion.id, output: suggestion.output }));
  });
  return { suggestions: saved, historicalTasks: retrieval.tasks, documentEvidence, degraded, model: `${configuredProvider}:${configuredModel}`, modelDurationMs, manualFallback: false };
}

