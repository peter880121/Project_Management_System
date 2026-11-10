import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient, type Role } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, failAudit: "", user: null as { id: string; role: Role } | null }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: async () => state.user }));
import { createConversation, listConversations, conversationDetail, beginQuestion, answerQuestion, updateConversation, type AssistantAdapters } from "@/modules/ai/assistant/services";
import { retrieveInternal, digest } from "@/modules/ai/assistant/retrieval";
import { assistantEvidence } from "@/modules/documents/rag-repositories";
import { documentEmbeddingModel } from "@/modules/ai/embeddings";
import { changeProjectLifecycle } from "@/modules/projects/lifecycle";
import { POST as messageRoute } from "@/app/api/assistant/conversations/[conversationId]/messages/route";
import type { GenerationStream } from "@/modules/ai/streaming/protocol";
import { GENERAL_PREFIX, REPORT_MESSAGE } from "@/modules/ai/assistant/routing";
import { SearchConfirmationRequired } from "@/modules/ai/assistant/web-confirmation";
import type { Citation } from "@/modules/ai/assistant/types";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (args.data.action === state.failAudit) throw new Error("Synthetic assistant audit outage"); return query(args); } } } });
const users = new Map<Role, string>(); let outsider: string, projectId: string, privateProject: string;
const actor = (role: Role = "PM") => ({ actorId: users.get(role)! });
const input = (expectedVersion = 1, question = "签名要求是什么？") => ({ question, requestKey: randomUUID(), expectedVersion, syntheticOnly: true as const });
const stream = (signal = new AbortController().signal): GenerationStream => ({ signal, generationId: randomUUID(), emit: vi.fn() });
const adapters: AssistantAdapters = { retrieve: (a, ids, q, signal) => retrieveInternal(a, ids, q, signal, { embed: async () => { throw new Error("Synthetic vector outage"); }, search: vi.fn(), load: assistantEvidence }), answer: async (_q, sources, _h, signal, delta) => { signal.throwIfAborted(); await delta("内部要求签署 [1]。"); return { answer: "内部要求签署 [1]。", model: "synthetic-only" }; } };
async function doc(scope = projectId, roles: Role[] = ["PM", "QA", "MEMBER", "ADMIN", "PMO"], text = "签名要求：合成任务须记录签署意图与日期。") {
  return db.$transaction(async tx => {
    const row = await tx.document.create({ data: { projectId: scope, filename: "synthetic.md", minioKey: `synthetic/${randomUUID()}.md`, uploadedById: users.get("PM")!, mediaType: "text/markdown", visibleRoles: roles, storageStatus: "AVAILABLE", parsedVersion: 1, chunkedVersion: 1, parseVersion: 1, parsedText: text, parseStatus: "SUCCEEDED" } });
    const job = await tx.documentParseJob.create({ data: { documentId: row.id, version: 1, requestedById: users.get("PM")!, requestKey: randomUUID(), modelVersion: "synthetic", sourceSha256: "a".repeat(64), sourceFilename: row.filename, sourceSize: 100, deadlineAt: new Date(), status: "SUCCEEDED", markdown: text } });
    const chunk = await tx.documentChunk.create({ data: { projectId: scope, documentId: row.id, parseJobId: job.id, version: 1, ordinal: 0, text, textSha256: digest(text), startOffset: 0, endOffset: text.length, embeddingModel: documentEmbeddingModel(), vectorStatus: "SYNCED" } }); return { row, chunk };
  });
}
async function ask(role: Role = "PM", question?: string, custom = adapters) {
  const conversation = await createConversation(projectId, actor(role)); const request = input(1, question); const begun = await beginQuestion(conversation.id, request, actor(role)); const events = stream(); const result = await answerQuestion(begun, request.question, actor(role), events, custom); return { conversation, request, begun, events, result };
}
describe.sequential("internal-first assistant, real MySQL and audit rollback", () => {
  beforeAll(async () => {
    if (!/^medpm_test_ia_/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) throw new Error("Requires isolated database");
    for (const file of ["rollback.sql", "migration.sql", "migration.sql"]) execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", `prisma/migrations/20261027000000_rag_assistant/${file}`, "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true });
    // The base-table rollback also removes dependent mode columns; restore them before using the generated client.
    for (const file of ["migration.sql", "rollback.sql", "migration.sql", "migration.sql"]) execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", `prisma/migrations/20261028000000_assistant_modes/${file}`, "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true });
    await db.$transaction(async tx => { for (const role of ["ADMIN", "PM", "QA", "MEMBER", "PMO"] as const) users.set(role, (await tx.user.create({ data: { name: role === "MEMBER" ? "张明" : `Synthetic ${role}`, email: `${randomUUID()}@medpm.local`, role, status: "ACTIVE" } })).id); outsider = (await tx.user.create({ data: { name: "张外部", email: `${randomUUID()}@medpm.local`, role: "PM", status: "ACTIVE" } })).id; });
  }, 30000);
  beforeEach(async () => {
    state.failAudit = ""; state.user = { id: users.get("PM")!, role: "PM" };
    await db.$transaction(async tx => { await tx.user.update({ where: { id: users.get("MEMBER")! }, data: { role: "MEMBER", status: "ACTIVE" } }); projectId = (await tx.project.create({ data: { name: "Synthetic internal assistant", ownerId: users.get("PM")!, status: "ACTIVE" } })).id; privateProject = (await tx.project.create({ data: { name: "Private other project", ownerId: outsider, status: "ACTIVE" } })).id; await tx.projectMember.createMany({ data: ["ADMIN", "QA", "MEMBER", "PMO"].map(role => ({ projectId, userId: users.get(role as Role)! })) }); });
  });
  afterAll(() => db.$disconnect());
  async function confirmed(conversationId: string, question = "Y市HIS最新FDA接口规范") {
    const request = { ...input(), question, mode: "WEB" as const }; let token: string | undefined;
    try { await beginQuestion(conversationId, request, actor()); } catch (error) { if (!(error instanceof SearchConfirmationRequired)) throw error; token = error.confirmation.token; expect(error.confirmation.query).toBe(question); }
    expect(token).toBeTruthy(); return { ...request, webConfirmationToken: token! };
  }
  const webEvidence = (): Citation[] => [{ ordinal: 1, sourceType: "WEB", projectId: null, documentId: null, chunkId: null, contactId: null, version: null, page: null, title: "Synthetic FDA source", snippet: "Public synthetic guidance", contentSha256: digest("Public synthetic guidance"), webUrl: "https://www.fda.gov/synthetic-guidance", retrievedAt: new Date(), publishedAt: new Date("2026-01-01T00:00:00Z") }];
  const modeAdapters = () => ({ ...adapters, retrieve: vi.fn(adapters.retrieve), answer: vi.fn(adapters.answer), general: vi.fn(async (_question: string, _signal: AbortSignal, delta: (text: string) => Promise<void>) => { const answer = `${GENERAL_PREFIX}\n\nWBS是工作分解结构。`; await delta(answer); return { answer, model: "synthetic-general" }; }), webSearch: vi.fn(async () => webEvidence()), webAnswer: vi.fn(async (_question: string, _citations: Citation[], _signal: AbortSignal, delta: (text: string) => Promise<void>) => { const answer = "以下基于外部资料，非内部制度 [1]。"; await delta(answer); return { answer, model: "synthetic-web" }; }) });
  it("answers common knowledge with the mandatory disclaimer without internal retrieval", async () => {
    const c = await createConversation(projectId, actor()); const request = { ...input(), question: "WBS是什么", mode: "SMART" as const }; const chosen = modeAdapters(); const begun = await beginQuestion(c.id, request, actor()); const result = await answerQuestion(begun, request.question, actor(), stream(), chosen);
    expect(result.answer.startsWith(GENERAL_PREFIX)).toBe(true); expect(Array.from(result.answer).length).toBeLessThanOrEqual(300); expect(result.intent).toBe("GENERAL"); expect(result.citations).toEqual([]); expect(chosen.retrieve).not.toHaveBeenCalled(); expect(chosen.webSearch).not.toHaveBeenCalled();
  });
  it.each(["SMART", "INTERNAL", "WEB"] as const)("blocks live business guesses before any model or search in %s mode", async mode => {
    const c = await createConversation(projectId, actor()); const request = { ...input(), question: "谁的负荷最重？有多少任务？", mode }; const chosen = modeAdapters(); const begun = await beginQuestion(c.id, request, actor()); const result = await answerQuestion(begun, request.question, actor(), stream(), chosen);
    expect(result.answer).toBe(REPORT_MESSAGE); expect(result.citations).toEqual([]); for (const fn of [chosen.retrieve, chosen.answer, chosen.general, chosen.webSearch, chosen.webAnswer]) expect(fn).not.toHaveBeenCalled();
  });
  it("never silently switches smart freshness questions to a live search", async () => { const c = await createConversation(projectId, actor()); const request = { ...input(), question: "最新FDA法规", mode: "SMART" as const }; const chosen = modeAdapters(); const result = await answerQuestion(await beginQuestion(c.id, request, actor()), request.question, actor(), stream(), chosen); expect(result.intent).toBe("NEED_WEB"); expect(result.answer).toContain("当前未进行联网搜索"); expect(chosen.general).not.toHaveBeenCalled(); expect(chosen.webSearch).not.toHaveBeenCalled(); });
  it("requires a server-bound confirmation before creating a web turn, and rejects changed questions", async () => {
    vi.stubEnv("TAVILY_API_KEY", "synthetic-fixture-only");
    try { const c = await createConversation(projectId, actor()); const request = await confirmed(c.id); expect(await db.ragMessage.count({ where: { conversationId: c.id } })).toBe(0); await expect(beginQuestion(c.id, { ...request, question: `${request.question} 新问题` }, actor())).rejects.toMatchObject({ status: 409 }); expect(await db.auditLog.count({ where: { action: "RAG_WEB_SEARCH_STARTED", projectId } })).toBe(0); }
    finally { vi.unstubAllEnvs(); }
  });
  it("sends only the exact approved query, persists real web citations and replays without another search", async () => {
    vi.stubEnv("TAVILY_API_KEY", "synthetic-fixture-only");
    try { await doc(projectId, ["PM"], "INTERNAL_ONLY_SECRET 签名证据"); const c = await createConversation(projectId, actor()); const request = await confirmed(c.id); const chosen = modeAdapters(); const begun = await beginQuestion(c.id, request, actor()); const result = await answerQuestion(begun, request.question, actor(), stream(), chosen); expect(chosen.retrieve).not.toHaveBeenCalled(); expect(chosen.webSearch).toHaveBeenCalledWith(request.question, expect.any(AbortSignal)); expect(chosen.webSearch.mock.calls[0]).toHaveLength(2); expect(chosen.webAnswer).toHaveBeenCalledWith(request.question, expect.any(Array), expect.any(AbortSignal), expect.any(Function)); expect(JSON.stringify(chosen.webAnswer.mock.calls)).not.toContain("INTERNAL_ONLY_SECRET"); expect(result.citations[0].sourceUrl).toBe("https://www.fda.gov/synthetic-guidance");
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: result.messageId, action: "RAG_WEB_SEARCH_CONFIRMED" } }); expect(audit.after).toMatchObject({ query: request.question, confirmationBoundToRequest: true });
      const replay = await beginQuestion(c.id, { ...request, webConfirmationToken: undefined }, actor()); expect(replay.cached).toBe(true); await answerQuestion(replay, request.question, actor(), stream(), chosen); expect(chosen.webSearch).toHaveBeenCalledTimes(1);
      const detail = await conversationDetail(c.id, actor().actorId); expect(detail.messages.at(-1)?.citations[0].sourceUrl).toBe("https://www.fda.gov/synthetic-guidance");
    } finally { vi.unstubAllEnvs(); }
  });
  it("does not call the provider if consent or outbound audit cannot commit", async () => {
    vi.stubEnv("TAVILY_API_KEY", "synthetic-fixture-only");
    try { const c = await createConversation(projectId, actor()); const request = await confirmed(c.id); state.failAudit = "RAG_WEB_SEARCH_CONFIRMED"; await expect(beginQuestion(c.id, request, actor())).rejects.toThrow(); expect(await db.ragMessage.count({ where: { conversationId: c.id } })).toBe(0); state.failAudit = ""; const begun = await beginQuestion(c.id, request, actor()); state.failAudit = "RAG_WEB_SEARCH_STARTED"; const chosen = modeAdapters(); await expect(answerQuestion(begun, request.question, actor(), stream(), chosen)).rejects.toThrow(); expect(chosen.webSearch).not.toHaveBeenCalled(); }
    finally { vi.unstubAllEnvs(); }
  });
  it("aborts an in-flight search and keeps no partial answer or citations", async () => {
    vi.stubEnv("TAVILY_API_KEY", "synthetic-fixture-only");
    try { const c = await createConversation(projectId, actor()); const request = await confirmed(c.id); const begun = await beginQuestion(c.id, request, actor()); const ac = new AbortController(); let notifyStarted!: () => void; const started = new Promise<void>(resolve => { notifyStarted = resolve; }); const chosen = modeAdapters(); const webSearch = vi.fn((_query: string, signal: AbortSignal) => new Promise<Citation[]>((_resolve, reject) => { notifyStarted(); signal.addEventListener("abort", () => reject(signal.reason), { once: true }); })); const pending = answerQuestion(begun, request.question, actor(), stream(ac.signal), { ...chosen, webSearch }); await started; ac.abort(new DOMException("Cancelled", "AbortError")); await expect(pending).rejects.toThrow(); expect(await db.ragMessage.findUniqueOrThrow({ where: { id: begun.message.id } })).toMatchObject({ status: "STOPPED", content: "" }); expect(await db.ragCitation.count({ where: { messageId: begun.message.id } })).toBe(0); expect(chosen.webAnswer).not.toHaveBeenCalled(); }
    finally { vi.unstubAllEnvs(); }
  });
  it("never falls back to fabricated knowledge after an external search failure", async () => {
    vi.stubEnv("TAVILY_API_KEY", "synthetic-fixture-only");
    try { const c = await createConversation(projectId, actor()); const request = await confirmed(c.id); const begun = await beginQuestion(c.id, request, actor()); const chosen = modeAdapters(); await expect(answerQuestion(begun, request.question, actor(), stream(), { ...chosen, webSearch: async () => { throw new Error("Synthetic provider outage"); } })).rejects.toThrow(); expect(chosen.general).not.toHaveBeenCalled(); expect(chosen.webAnswer).not.toHaveBeenCalled(); expect(await db.ragCitation.count({ where: { messageId: begun.message.id } })).toBe(0); }
    finally { vi.unstubAllEnvs(); }
  });
  it.each(["ADMIN", "PM", "QA", "MEMBER", "PMO"] as const)("serves grounded internal knowledge to %s with exact citations and audit", async role => {
    const evidence = await doc(); const { result, events } = await ask(role); expect(result.answer).toContain("[1]"); expect(result.citations[0].chunkId).toBe(evidence.chunk.id); expect(result.retrievalMode).toBe("keyword"); expect(events.emit).toHaveBeenCalledWith(expect.objectContaining({ event: "delta" }));
    expect(await db.auditLog.count({ where: { entityId: result.messageId, action: { in: ["RAG_SEARCH", "RAG_ANSWER_COMPLETED"] } } })).toBe(2);
  });
  it("prefers maintained internal contacts without calling the LLM or external retrieval", async () => {
    const answer = vi.fn(adapters.answer); const { result } = await ask("PM", "请帮我查找张工的联系方式", { ...adapters, answer }); expect(result.retrievalMode).toBe("internal-contacts"); expect(result.answer).toContain("张明"); expect(result.answer).toContain((await db.user.findUniqueOrThrow({ where: { id: users.get("MEMBER")! } })).email); expect(result.answer).not.toContain("张外部"); expect(answer).not.toHaveBeenCalled();
  });
  it("does not leak private projects, meetings, draft deliverables or stale vector IDs", async () => {
    const hidden = await doc(privateProject); const privateDoc = await doc(projectId, ["PM"]); const publicDoc = await doc();
    const meeting = await db.$transaction(tx => tx.meetingRecord.create({ data: { projectId, title: "Private meeting", content: "签名要求", meetingDate: new Date(), visibleRoles: ["PM"], actionItems: [], status: "FINALIZED", createdById: users.get("PM")!, requestKey: randomUUID() } }));
    await db.$transaction(tx => tx.document.update({ where: { id: privateDoc.row.id }, data: { meetingAttachmentId: meeting.id, visibleRoles: ["PM", "QA"] } }));
    const ids = [hidden.chunk.id, privateDoc.chunk.id, publicDoc.chunk.id]; const rows = await assistantEvidence({ projectIds: [projectId], role: "QA" }, "签名", ids); expect(rows.map(row => row.id)).toEqual([publicDoc.chunk.id]);
    const { result } = await ask("QA"); expect(result.citations.map(c => c.chunkId)).toEqual([publicDoc.chunk.id]);
    await expect(createConversation(privateProject, actor())).rejects.toMatchObject({ status: 403 });
  });
  it("isolates conversations between users and rejects request-body authorization injection", async () => {
    const c = await createConversation(projectId, actor()); await expect(conversationDetail(c.id, users.get("QA")!)).rejects.toMatchObject({ status: 404 }); expect(await listConversations(users.get("QA")!)).not.toContainEqual(expect.objectContaining({ id: c.id }));
    const res = await messageRoute(new Request(`http://localhost/api/assistant/conversations/${c.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input(), role: "ADMIN", projectIds: [privateProject] }) }), { params: Promise.resolve({ conversationId: c.id }) }); expect(res.status).toBe(400); expect(await db.ragMessage.count({ where: { conversationId: c.id } })).toBe(0);
  });
  it("returns no-evidence honestly without calling an LLM", async () => { const answer = vi.fn(adapters.answer); const { result } = await ask("PM", "不存在的条款", { ...adapters, answer }); expect(result.answer).toContain("未找到足够依据"); expect(result.citations).toEqual([]); expect(answer).not.toHaveBeenCalled(); });
  it("deduplicates completed requests and rejects concurrent turns", async () => {
    await doc(); const { result, conversation, request } = await ask(); const replay = await beginQuestion(conversation.id, request, actor()); expect(replay.cached).toBe(true); const output = await answerQuestion(replay, request.question, actor(), stream(), adapters); expect(output.messageId).toBe(result.messageId); expect(await db.ragMessage.count({ where: { conversationId: conversation.id } })).toBe(2);
    const next = await beginQuestion(conversation.id, input(result.rowVersion), actor()); await expect(beginQuestion(conversation.id, input(next.conversation.rowVersion), actor())).rejects.toMatchObject({ status: 409 });
  });
  it("rolls back completed answers and citations if the completion audit fails", async () => {
    await doc(); state.failAudit = "RAG_ANSWER_COMPLETED"; await expect(ask()).rejects.toThrow(); const row = await db.ragMessage.findFirstOrThrow({ where: { conversation: { projectId }, role: "ASSISTANT" } }); expect(row).toMatchObject({ status: "FAILED", content: "" }); expect(await db.ragCitation.count({ where: { messageId: row.id } })).toBe(0);
  });
  it("sends no model input if retrieval cannot be audited", async () => {
    await doc(); state.failAudit = "RAG_SEARCH"; const answer = vi.fn(adapters.answer); await expect(ask("PM", undefined, { ...adapters, answer })).rejects.toThrow(); expect(answer).not.toHaveBeenCalled();
  });
  it("rolls back the initial question if its audit fails", async () => { const c = await createConversation(projectId, actor()); state.failAudit = "RAG_QUESTION_SUBMITTED"; await expect(beginQuestion(c.id, input(), actor())).rejects.toThrow(); expect(await db.ragMessage.count({ where: { conversationId: c.id } })).toBe(0); expect((await db.ragConversation.findUniqueOrThrow({ where: { id: c.id } })).rowVersion).toBe(1); });
  it("rejects unauthenticated, cross-origin and overlong requests before starting SSE", async () => {
    const c = await createConversation(projectId, actor()); const context = { params: Promise.resolve({ conversationId: c.id }) };
    state.user = null; expect((await messageRoute(new Request("http://localhost/api", { method: "POST" }), context)).status).toBe(401);
    state.user = { id: actor().actorId, role: "PM" }; expect((await messageRoute(new Request("http://localhost/api", { method: "POST", headers: { origin: "https://external.invalid" } }), context)).status).toBe(403);
    const response = await messageRoute(new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input(), question: "x".repeat(2001) }) }), context); expect(response.status).toBe(400); expect(response.headers.get("content-type")).toContain("application/json"); expect(await db.ragMessage.count({ where: { conversationId: c.id } })).toBe(0);
  });
  it("does not use corrupted chunk text as model evidence", async () => { const evidence = await doc(); await db.$transaction(tx => tx.documentChunk.update({ where: { id: evidence.chunk.id }, data: { text: "签名被篡改的合成内容" } })); const answer = vi.fn(adapters.answer); const { result } = await ask("PM", undefined, { ...adapters, answer }); expect(result.citations).toHaveLength(0); expect(answer).not.toHaveBeenCalled(); });
  it("aborts with no half-answer or citation persistence", async () => {
    await doc(); const c = await createConversation(projectId, actor()); const request = input(); const begun = await beginQuestion(c.id, request, actor()); const ac = new AbortController();
    await expect(answerQuestion(begun, request.question, actor(), stream(ac.signal), { ...adapters, answer: async (_q, _s, _h, signal, delta) => { await delta("未完成"); ac.abort(new DOMException("Cancelled", "AbortError")); signal.throwIfAborted(); return { answer: "", model: "synthetic" }; } })).rejects.toThrow();
    expect(await db.ragMessage.findUniqueOrThrow({ where: { id: begun.message.id } })).toMatchObject({ status: "STOPPED", content: "" }); expect(await db.ragCitation.count({ where: { messageId: begun.message.id } })).toBe(0);
  });
  it("rechecks permissions at completion, hides history after revocation and excludes it from context", async () => {
    await doc(); const successful = await ask("MEMBER"); const c = await createConversation(projectId, actor("MEMBER")); const request = input(); const begun = await beginQuestion(c.id, request, actor("MEMBER"));
    await expect(answerQuestion(begun, request.question, actor("MEMBER"), stream(), { ...adapters, answer: async () => { await db.$transaction(tx => tx.projectMember.update({ where: { projectId_userId: { projectId, userId: users.get("MEMBER")! } }, data: { active: false } })); return { answer: "内部要求 [1]", model: "synthetic" }; } })).rejects.toMatchObject({ status: 403 });
    const detail = await conversationDetail(successful.conversation.id, users.get("MEMBER")!); expect(detail.messages.every(m => m.redacted && !m.citations.length)).toBe(true); expect(await db.ragCitation.count({ where: { messageId: begun.message.id } })).toBe(0);
    expect(detail.title).toBe("来源权限已变化的对话"); expect((await listConversations(users.get("MEMBER")!)).filter(row => row.id === successful.conversation.id)[0].title).toBe("来源权限已变化的对话");
  });
  it("allows read-only chat on frozen projects without changing project evidence", async () => {
    await doc(); await changeProjectLifecycle(projectId, "pause", { expectedRowVersion: 1, requestKey: randomUUID(), reason: "Synthetic pause to verify read-only assistant" }, actor()); const before = await db.project.findUniqueOrThrow({ where: { id: projectId } }); const { result } = await ask(); expect(result.answer).toContain("[1]"); expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toEqual(before);
  });
  it("hides rather than deletes conversations and refuses destructive schema rollback", async () => {
    const c = await createConversation(projectId, actor()); await updateConversation(c.id, { expectedVersion: 1, title: "Synthetic renamed" }, actor()); await updateConversation(c.id, { expectedVersion: 2, hidden: true }, actor()); expect(await db.ragConversation.findUnique({ where: { id: c.id } })).not.toBeNull(); await expect(conversationDetail(c.id, actor().actorId)).rejects.toMatchObject({ status: 404 });
    expect(() => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/migrations/20261027000000_rag_assistant/rollback.sql", "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true })).toThrow();
    expect(() => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/migrations/20261028000000_assistant_modes/rollback.sql", "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true })).toThrow(/RAG_MODES_ROLLBACK_BLOCKED_PRESERVE_EVIDENCE/);
    expect(await db.ragMessage.count({ where: { mode: "WEB" } })).toBeGreaterThan(0);
  });
});
