import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { ProjectAccessError } from "@/modules/auth/project-access";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { ProjectError } from "@/modules/projects/services";
import { canReadDocument, meetingAttachmentSelect } from "@/modules/documents/access";
import type { GenerationStream } from "@/modules/ai/streaming/protocol";
import { ControlTextCleaner } from "@/modules/ai/streaming/clean-text";
import * as repository from "./repositories";
import { digest, contactText, retrieveInternal, type Retrieval } from "./retrieval";
import { streamAnswer, streamGeneralAnswer, streamWebAnswer, validateAnswer, validateGeneralAnswer } from "./model";
import { questionSchema, publicCitation, safeSourceUrl, type Citation, type ChatMessage, type ConversationDto, type conversationEditSchema } from "./types";
import { routeQuestion, REPORT_MESSAGE, type AssistantMode } from "./routing";
import { requireWebConfirmation, externalQuery } from "./web-confirmation";
import { searchWeb, webSearchConfigured, WEB_SEARCH_NOT_CONFIGURED } from "./web-search";
import type { z } from "zod";
type Actor = { actorId: string } & AuditRequestMetadata;
const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 };
const idsOf = (value: unknown): string[] => Array.isArray(value) && value.every(id => typeof id === "string") ? value : [];
export async function createConversation(projectId: string | null, actor: Actor) {
  return prisma.$transaction(async tx => {
    const user = await repository.activeActor(tx, actor.actorId, true); await repository.projects(tx, user, projectId);
    const row = await tx.ragConversation.create({ data: { userId: user.id, projectId, title: "新对话" } });
    await recordAudit(tx, { ...actor, action: "RAG_CONVERSATION_CREATED", entityType: "RagConversation", entityId: row.id, after: { scopeProjectId: projectId } }); return row;
  }, txOptions);
}
export async function listConversations(actorId: string, page = 1) {
  const actor = await repository.activeActor(prisma, actorId); const allowed = new Set((await repository.projects(prisma, actor)).map(row => row.id));
  const rows = await prisma.ragConversation.findMany({ where: { userId: actorId, hiddenAt: null }, select: { id: true, title: true, projectId: true, rowVersion: true, updatedAt: true, messages: { where: { role: "USER" }, orderBy: { sequence: "asc" }, take: 1, select: { actorRole: true, scopeProjectIds: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 30, skip: (page - 1) * 30 });
  return rows.map(({ messages, ...row }) => ({ ...row, title: row.projectId && !allowed.has(row.projectId) || messages.some(m => m.actorRole !== actor.role || !idsOf(m.scopeProjectIds).every(id => allowed.has(id))) ? "来源权限已变化的对话" : row.title }));
}
export async function updateConversation(id: string, input: z.infer<typeof conversationEditSchema>, actor: Actor) {
  return prisma.$transaction(async tx => {
    const row = await repository.ownedConversation(tx, id, actor.actorId, true); await repository.activeActor(tx, actor.actorId, true);
    if (row.rowVersion !== input.expectedVersion || row.activeRequestId && row.leaseUntil && row.leaseUntil > new Date()) throw new ProjectError("会话正在生成或已更新，请刷新后重试", 409);
    const updated = await tx.ragConversation.update({ where: { id }, data: { ...(input.title ? { title: input.title } : {}), ...(input.hidden ? { hiddenAt: new Date() } : {}), rowVersion: { increment: 1 } } });
    await recordAudit(tx, { ...actor, action: "RAG_CONVERSATION_UPDATED", entityType: "RagConversation", entityId: id, before: { title: row.title }, after: { title: updated.title, hidden: !!updated.hiddenAt } }); return updated;
  }, txOptions);
}

/** Revalidate source authorization and pinned content; stored conversation text never grants access. */
async function sourcesAllowed(db: repository.Db, actor: AuthenticatedUser, projectIds: string[], citations: Citation[]) {
  const allowed = new Set(projectIds);
  if (citations.some(c => c.projectId && !allowed.has(c.projectId))) return false;
  const contactIds = citations.flatMap(c => c.contactId ? [c.contactId] : []);
  const people = contactIds.length ? await repository.contacts(db, actor, projectIds, undefined, contactIds) : [];
  const docIds = citations.flatMap(c => c.documentId ? [c.documentId] : []);
  const docs = docIds.length ? await db.document.findMany({ where: { id: { in: docIds } }, include: { meetingAttachment: { select: meetingAttachmentSelect }, deliverable: { select: { status: true } } } }) : [];
  const chunkIds = citations.flatMap(c => c.chunkId ? [c.chunkId] : []);
  const chunks = chunkIds.length ? await db.documentChunk.findMany({ where: { id: { in: chunkIds } }, select: { id: true, documentId: true, projectId: true, version: true, textSha256: true, text: true } }) : [];
  return citations.every(c => {
    if (c.sourceType === "WEB") return !!safeSourceUrl(c.webUrl) && digest(c.snippet) === c.contentSha256 && !c.projectId && !c.documentId && !c.contactId;
    if (c.sourceType === "CONTACT") { const person = people.find(p => p.id === c.contactId); return !!person && digest(contactText(person)) === c.contentSha256; }
    const doc = docs.find(d => d.id === c.documentId); const chunk = chunks.find(row => row.id === c.chunkId);
    return !!doc && !!chunk && doc.projectId === c.projectId && chunk.projectId === c.projectId && chunk.documentId === doc.id && chunk.version === c.version && chunk.textSha256 === c.contentSha256 && digest(chunk.text) === c.contentSha256 && doc.storageStatus === "AVAILABLE" && canReadDocument(doc, actor.role) && doc.meetingAttachment?.status !== "DRAFT" && (!doc.deliverable || doc.deliverable.status === "APPROVED");
  });
}
export async function conversationDetail(id: string, actorId: string, beforeSequence?: number): Promise<ConversationDto> {
  return prisma.$transaction(async tx => {
    const row = await repository.ownedConversation(tx, id, actorId); const actor = await repository.activeActor(tx, actorId);
    const allowed = await repository.projects(tx, actor); const projectIds = allowed.map(p => p.id); const allowedIds = new Set(projectIds);
    const messages = await tx.ragMessage.findMany({ where: { conversationId: id, ...(beforeSequence ? { sequence: { lt: beforeSequence } } : {}) }, include: { citations: { orderBy: { ordinal: "asc" } } }, orderBy: { sequence: "desc" }, take: 41 });
    const result: ChatMessage[] = [];
    for (const message of messages.slice(0, 40).reverse()) {
      const citations = message.citations as Citation[];
      const permitted = message.actorRole === actor.role && idsOf(message.scopeProjectIds).every(projectId => allowedIds.has(projectId)) && await sourcesAllowed(tx, actor, projectIds, citations);
      const timedOut = message.status === "GENERATING" && (!row.leaseUntil || row.leaseUntil < new Date());
      result.push({ id: message.id, requestKey: message.requestKey, mode: message.mode, intent: message.intent, role: message.role, content: permitted ? message.content : "来源权限已变化，此消息已隐藏", status: timedOut ? "FAILED" : message.status, retrievalMode: permitted ? message.retrievalMode : null, citations: permitted ? citations.map(publicCitation) : [], redacted: !permitted });
    }
    return { id: row.id, title: result.some(m => m.redacted) ? "来源权限已变化的对话" : row.title, projectId: row.projectId, rowVersion: row.rowVersion, messages: result, hasMore: messages.length > 40, ...(messages.length ? { oldestSequence: messages.slice(0, 40).at(-1)!.sequence } : {}) };
  }, txOptions);
}
export async function beginQuestion(id: string, raw: z.input<typeof questionSchema>, actor: Actor) {
  const input = questionSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const conversation = await repository.ownedConversation(tx, id, actor.actorId, true);
    const user = await repository.activeActor(tx, actor.actorId, true); const scope = await repository.projects(tx, user, conversation.projectId);
    const prior = await tx.ragMessage.findUnique({ where: { conversationId_requestKey_role: { conversationId: id, requestKey: input.requestKey, role: "ASSISTANT" } }, include: { citations: { orderBy: { ordinal: "asc" } } } });
    if (prior) {
      const question = await tx.ragMessage.findUniqueOrThrow({ where: { conversationId_requestKey_role: { conversationId: id, requestKey: input.requestKey, role: "USER" } } });
      if (question.content !== input.question || question.mode !== input.mode) throw new ProjectError("请求标识已用于其他问题或模式", 409);
      if (prior.status !== "COMPLETED") throw new ProjectError("本轮已提交，请刷新核实；重试请发起新一轮", 409);
      const all = await repository.projects(tx, user);
      if (prior.actorRole !== user.role || !idsOf(prior.scopeProjectIds).every(pid => all.some(p => p.id === pid)) || !await sourcesAllowed(tx, user, all.map(p => p.id), prior.citations as Citation[])) throw new ProjectAccessError();
      return { message: prior, user, projectIds: scope.map(p => p.id), conversation, cached: true as const };
    }
    if (conversation.rowVersion !== input.expectedVersion) throw new ProjectError("会话已变化，请刷新后重试", 409);
    if (conversation.activeRequestId && conversation.leaseUntil && conversation.leaseUntil > new Date()) throw new ProjectError("当前会话正在生成，请先停止或等待完成", 409);
    if (await tx.ragConversation.count({ where: { userId: actor.actorId, leaseUntil: { gt: new Date() }, activeRequestId: { not: null } } }) >= 2) throw new ProjectError("同时生成的对话过多，请先停止其他对话", 409);
    const route = routeQuestion(input.mode, input.question, scope.map(p => p.name));
    if (route.intent === "WEB") {
      if (!webSearchConfigured()) throw new ProjectError(WEB_SEARCH_NOT_CONFIGURED, 503);
      requireWebConfirmation({ actorId: user.id, actorRole: user.role, conversationId: id, projectId: conversation.projectId, expectedVersion: input.expectedVersion, requestKey: input.requestKey, question: input.question, mode: "WEB" }, input.webConfirmationToken, scope.map(p => p.name));
    }
    await tx.ragMessage.updateMany({ where: { conversationId: id, status: "GENERATING" }, data: { status: "FAILED" } });
    const projectIds = scope.map(p => p.id); const sequence = conversation.rowVersion * 2;
    const routing = { mode: input.mode, intent: route.intent, webQuery: route.intent === "WEB" ? externalQuery(input.question) : null };
    await tx.ragMessage.create({ data: { conversationId: id, requestKey: input.requestKey, sequence, role: "USER", actorRole: user.role, content: input.question, status: "COMPLETED", scopeProjectIds: projectIds, ...routing } });
    const message = await tx.ragMessage.create({ data: { conversationId: id, requestKey: input.requestKey, sequence: sequence + 1, role: "ASSISTANT", actorRole: user.role, content: "", status: "GENERATING", scopeProjectIds: projectIds, ...routing } });
    const updated = await tx.ragConversation.update({ where: { id }, data: { activeRequestId: input.requestKey, leaseUntil: new Date(Date.now() + 120000), rowVersion: { increment: 1 } } });
    await recordAudit(tx, { ...actor, action: "RAG_QUESTION_SUBMITTED", entityType: "RagMessage", entityId: message.id, after: { conversationId: id, query: input.question, projectIds, sourcePriority: "INTERNAL_FIRST", requestKey: input.requestKey, mode: input.mode, intent: route.intent, routingReason: route.reason } });
    if (route.intent === "WEB") await recordAudit(tx, { ...actor, action: "RAG_WEB_SEARCH_CONFIRMED", entityType: "RagMessage", entityId: message.id, after: { query: routing.webQuery, provider: "tavily", requestKey: input.requestKey, confirmationBoundToRequest: true } });
    return { message, user, projectIds, conversation: updated, cached: false as const };
  }, txOptions);
}
type Begun = Awaited<ReturnType<typeof beginQuestion>>;
export type AssistantAdapters = { retrieve: typeof retrieveInternal; answer: typeof streamAnswer; general?: typeof streamGeneralAnswer; webSearch?: typeof searchWeb; webAnswer?: typeof streamWebAnswer };
const production: AssistantAdapters = { retrieve: retrieveInternal, answer: streamAnswer, general: streamGeneralAnswer, webSearch: searchWeb, webAnswer: streamWebAnswer };
async function verifyGeneration(db: repository.Db, begun: Begun, citations: Citation[], lock = false) {
  if (lock && begun.projectIds.length) await db.$queryRaw(Prisma.sql`SELECT id FROM Project WHERE id IN (${Prisma.join([...begun.projectIds].sort())}) ORDER BY id FOR UPDATE`);
  const current = await repository.activeActor(db, begun.user.id, lock);
  const allowed = await repository.projects(db, current); const projectIds = allowed.map(p => p.id);
  if (current.role !== begun.user.role || !begun.projectIds.every(id => projectIds.includes(id)) || !await sourcesAllowed(db, current, projectIds, citations)) throw new ProjectAccessError("来源或权限已变化，请重新提问");
  return current;
}
export async function answerQuestion(begun: Begun, question: string, actor: Actor, stream: GenerationStream, adapters = production, assertSession?: () => Promise<void>) {
  if (begun.cached) {
    const citations = "citations" in begun.message ? begun.message.citations as Citation[] : [];
    return { messageId: begun.message.id, conversationId: begun.conversation.id, rowVersion: begun.conversation.rowVersion, mode: begun.message.mode as AssistantMode, intent: begun.message.intent, answer: begun.message.content, citations: citations.map(publicCitation), retrievalMode: begun.message.retrievalMode ?? "keyword" };
  }
  const controller = new AbortController(); const abort = () => controller.abort(stream.signal.reason); stream.signal.addEventListener("abort", abort, { once: true }); if (stream.signal.aborted) abort();
  let timer: ReturnType<typeof setInterval> | undefined; let checking = false; let lastCheck = 0; let evidence: Citation[] = [];
  async function check() {
    controller.signal.throwIfAborted(); await assertSession?.(); await verifyGeneration(prisma, begun, evidence); lastCheck = Date.now(); controller.signal.throwIfAborted();
  }
  try {
    await check();
    timer = setInterval(() => { if (!checking) { checking = true; void check().catch(error => controller.abort(error)).finally(() => { checking = false; }); } }, 2500);
    const intent = begun.message.intent ?? "INTERNAL";
    const delta = async (text: string) => { controller.signal.throwIfAborted(); if (Date.now() - lastCheck > 2000) await check(); for (let offset = 0; offset < text.length; offset += 1000) stream.emit({ event: "delta", data: { text: text.slice(offset, offset + 1000) } }); };
    let retrieval: Retrieval = { citations: [], mode: intent === "GENERAL" ? "general" : intent === "WEB" ? "web" : "system", degraded: false, reason: null, durationMs: 0 };
    let output: { answer: string; model: string };
    async function auditSources(query: string) {
      await prisma.$transaction(async tx => {
        await verifyGeneration(tx, begun, evidence, true); controller.signal.throwIfAborted();
        await recordAudit(tx, { ...actor, action: "RAG_SEARCH", entityType: "RagMessage", entityId: begun.message.id, after: { query, projectIds: begun.projectIds, hitIds: evidence.map(c => c.chunkId ?? c.contactId ?? c.webUrl!), evidence: evidence.map(c => ({ projectId: c.projectId, documentId: c.documentId, version: c.version, contentSha256: c.contentSha256, ...(c.sourceType === "WEB" ? { url: c.webUrl! } : {}) })), mode: retrieval.mode, degraded: retrieval.degraded, reason: retrieval.reason, durationMs: retrieval.durationMs } });
      }, txOptions);
      await check();
    }
    if (intent === "REPORT_GUARD") {
      output = { answer: REPORT_MESSAGE, model: "system-business-report-guard" }; await delta(output.answer);
    } else if (intent === "NEED_WEB") {
      output = { answer: "这个问题需要联网核验时效。请切换『联网研究』并确认搜索词；当前未进行联网搜索。", model: "system-web-required" }; await delta(output.answer);
    } else if (intent === "GENERAL") {
      stream.emit({ event: "progress", data: { stage: "general", message: "正在整理通用行业知识，未查询项目库…" } });
      output = await (adapters.general ?? streamGeneralAnswer)(question, controller.signal, delta); validateGeneralAnswer(output.answer);
    } else if (intent === "WEB") {
      const query = begun.message.webQuery; if (!query) throw new ProjectError("缺少已确认的搜索词，请重新确认", 409);
      await prisma.$transaction(async tx => { await verifyGeneration(tx, begun, [], true); controller.signal.throwIfAborted(); await assertSession?.(); await recordAudit(tx, { ...actor, action: "RAG_WEB_SEARCH_STARTED", entityType: "RagMessage", entityId: begun.message.id, after: { query, provider: "tavily", internalContextAttached: false } }); }, txOptions);
      stream.emit({ event: "progress", data: { stage: "web-search", message: "正在使用已确认的搜索词联网检索…" } });
      const started = Date.now(); evidence = await (adapters.webSearch ?? searchWeb)(query, controller.signal);
      if (evidence.some(c => c.sourceType !== "WEB")) throw new Error("Unexpected external source type");
      retrieval = { citations: evidence, mode: "web", degraded: false, reason: null, durationMs: Date.now() - started }; await auditSources(query);
      if (!evidence.length) { output = { answer: "联网搜索未找到可核验的资料，未生成无依据结论。请调整搜索词后重试。", model: "web-no-evidence" }; await delta(output.answer); }
      else { output = await (adapters.webAnswer ?? streamWebAnswer)(query, evidence, controller.signal, delta); validateAnswer(output.answer, evidence); }
    } else {
      stream.emit({ event: "progress", data: { stage: "retrieving", message: "优先检索内部人员资料与项目知识库…" } });
      const detail = await conversationDetail(begun.conversation.id, actor.actorId);
      // External and general replies never become internal factual context.
      const history = detail.messages.filter(m => !m.redacted && m.status === "COMPLETED" && m.id !== begun.message.id && (!m.intent || m.intent === "INTERNAL"));
      const lastQuestion = history.filter(m => m.role === "USER").at(-2)?.content;
      const query = /他|她|它|这个|这些|上面|该|还有|that|their/i.test(question) && lastQuestion ? `${question}\n${lastQuestion.slice(0, 500)}` : question;
      retrieval = await adapters.retrieve(begun.user, begun.projectIds, query, controller.signal); evidence = retrieval.citations; await auditSources(query);
      stream.emit({ event: "progress", data: { stage: "answering", message: !evidence.length ? "内部检索未找到足够依据" : retrieval.mode === "internal-contacts" ? "已找到内部人员资料" : retrieval.degraded ? "已降级为内部关键词检索，正在整理依据…" : "已找到内部资料，正在整理回答…" } });
      if (!evidence.length) { output = { answer: "当前可访问的内部资料中未找到足够依据。请补充姓名、项目或关键词，或请项目负责人完善并同步内部知识库。", model: "internal-evidence-only" }; await delta(output.answer); }
      else if (retrieval.mode === "internal-contacts") { output = { answer: `已优先找到以下内部联系人${evidence.length > 1 ? "，请根据姓名和邮箱确认具体人员" : ""}：\n\n${evidence.map(c => `${c.snippet} [${c.ordinal}]`).join("\n\n")}`, model: "internal-directory" }; await delta(output.answer); }
      else { output = await adapters.answer(question, evidence, history, controller.signal, delta); validateAnswer(output.answer, evidence); }
    }
    controller.signal.throwIfAborted(); await assertSession?.();
    const cleaner = new ControlTextCleaner(); const answer = cleaner.push(output.answer).text; cleaner.finish();
    const completed = await prisma.$transaction(async tx => {
      const conversation = await repository.ownedConversation(tx, begun.conversation.id, actor.actorId, true);
      await verifyGeneration(tx, begun, evidence, true); controller.signal.throwIfAborted();
      if (conversation.activeRequestId !== begun.message.requestKey || !conversation.leaseUntil || conversation.leaseUntil < new Date()) throw new ProjectError("本轮生成已失效，请刷新会话", 409);
      const changed = await tx.ragMessage.updateMany({ where: { id: begun.message.id, status: "GENERATING" }, data: { content: answer, status: "COMPLETED", model: output.model, retrievalMode: retrieval.mode } });
      if (changed.count !== 1) throw new ProjectError("回答状态已变化", 409);
      if (evidence.length) await tx.ragCitation.createMany({ data: evidence.map(c => ({ ...c, id: randomUUID(), messageId: begun.message.id })) });
      const row = await tx.ragConversation.update({ where: { id: conversation.id }, data: { activeRequestId: null, leaseUntil: null, title: conversation.title === "新对话" ? question.slice(0, 80) : conversation.title, rowVersion: { increment: 1 } } });
      await recordAudit(tx, { ...actor, action: "RAG_ANSWER_COMPLETED", entityType: "RagMessage", entityId: begun.message.id, after: { conversationId: row.id, model: output.model, answerSha256: digest(answer), citationIds: evidence.map(c => c.chunkId ?? c.contactId ?? c.webUrl!), retrievalMode: retrieval.mode, mode: begun.message.mode, intent } });
      return { messageId: begun.message.id, conversationId: row.id, rowVersion: row.rowVersion, answer, mode: begun.message.mode as AssistantMode, intent, citations: evidence.map(publicCitation), retrievalMode: retrieval.mode };
    }, txOptions);
    return completed;
  } catch (error) {
    const stopped = stream.signal.aborted && stream.signal.reason?.name === "AbortError";
    try {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM RagConversation WHERE id=${begun.conversation.id} FOR UPDATE`;
        const changed = await tx.ragMessage.updateMany({ where: { id: begun.message.id, status: "GENERATING" }, data: { status: stopped ? "STOPPED" : "FAILED", content: "" } });
        await tx.ragConversation.updateMany({ where: { id: begun.conversation.id, activeRequestId: begun.message.requestKey }, data: { activeRequestId: null, leaseUntil: null, rowVersion: { increment: 1 } } });
        if (changed.count) await recordAudit(tx, { ...actor, action: stopped ? "RAG_ANSWER_STOPPED" : "RAG_ANSWER_FAILED", entityType: "RagMessage", entityId: begun.message.id, after: { reason: stopped ? "CLIENT_CANCELLED" : "GENERATION_UNAVAILABLE" } });
      }, txOptions);
    } catch { console.warn("RAG_FAILURE_AUDIT_UNAVAILABLE", { messageId: begun.message.id }); }
    if (controller.signal.aborted && !stream.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally { clearInterval(timer); stream.signal.removeEventListener("abort", abort); controller.abort(); }
}
