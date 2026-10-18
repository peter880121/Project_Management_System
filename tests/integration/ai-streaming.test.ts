import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: null as { id: string; role: "PM" } | null, stream: vi.fn(), auditFailure: false }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: async () => state.actor }));
vi.mock("@/modules/ai/chat-model", () => ({ getConfiguredLlm: () => ({ provider: "openai", modelName: "synthetic-stream", model: { stream: state.stream } }) }));
vi.mock("@/modules/ai/wbs/history", () => ({ retrieveHistoricalTasks: async () => ({ tasks: [], hitIds: [], durationMs: 1, degraded: false }) }));
vi.mock("@/modules/documents/rag-service", () => ({ searchProjectDocuments: async () => ({ hits: [], hitIds: [], mode: "VECTOR", durationMs: 1, degraded: false }) }));
import { POST as wbs } from "@/app/api/projects/[projectId]/ai/wbs/route";
import { POST as compliance } from "@/app/api/audit/summary/route";
import { SseDecoder } from "@/modules/ai/streaming/protocol";
import { generateWbsSuggestions } from "@/modules/ai/wbs/service";

const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => {
  if (state.auditFailure && args.data.action === "AI_WBS_GENERATED") throw new Error("Synthetic audit outage");
  return query(args);
} } } });
let actorId: string; let projectId: string; let sourceTaskId: string; let complianceTaskId: string;
const tasks = JSON.stringify({ tasks: Array.from({ length: 3 }, (_, index) => ({ title: `Synthetic streamed child ${index}`, description: "Synthetic delivery evidence", estimateHours: 2, suggestedRole: "QA", dependencies: [] })) });
const summary = JSON.stringify({ overview: "合成合规摘要", keyChanges: [], anomalies: [], reviewItems: [] });
function modelStream(raw: string, beforeResult?: () => Promise<void>) {
  const iterator = (async function* () { yield { content: "<PUBLIC_PREVIEW>正在核对合成交付证据。" }; if (beforeResult) await beforeResult(); yield { content: `<RESULT_JSON>${raw}` }; })();
  return Object.assign(iterator, { cancel: async () => { await iterator.return(undefined); } });
}
function request(path: string, body: unknown) { return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body) }); }
const runWbs = () => wbs(request(`/api/projects/${projectId}/ai/wbs`, { sourceTaskId, request: "Synthetic refinement request", syntheticDataConfirmed: true }), { params: Promise.resolve({ projectId }) });
async function events(response: Response) { const parser = new SseDecoder(); return [...parser.push(new TextEncoder().encode(await response.text())), ...parser.push()]; }

describe.sequential("SSE routes with real MySQL business transactions", () => {
  beforeAll(() => { if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL || "").hostname)) throw new Error("Only local synthetic MySQL is allowed"); });
  beforeEach(async () => {
    state.auditFailure = false; state.stream.mockReset();
    await db.$transaction(async tx => {
      actorId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic streaming PM", role: "PM", status: "ACTIVE" } })).id;
      projectId = (await tx.project.create({ data: { name: "Synthetic stream integration", ownerId: actorId } })).id;
      sourceTaskId = (await tx.task.create({ data: { projectId, title: "蓝图方案确认" } })).id;
      complianceTaskId = (await tx.task.create({ data: { projectId, title: "用户验收测试 UAT" } })).id;
    });
    state.actor = { id: actorId, role: "PM" }; state.stream.mockImplementation(async () => modelStream(tasks));
  });
  afterAll(() => db.$disconnect());
  it("sends ordinary HTTP errors before streaming for unauthorized or invalid task requests", async () => {
    state.actor = null; const denied = await runWbs(); expect(denied.status).toBe(401); expect(denied.headers.get("content-type")).toContain("application/json");
    state.actor = { id: actorId, role: "PM" };
    const invalid = await wbs(request(`/api/projects/${projectId}/ai/wbs`, { sourceTaskId: randomUUID(), request: "Synthetic refinement request", syntheticDataConfirmed: true }), { params: Promise.resolve({ projectId }) });
    expect(invalid.status).toBe(404); expect(state.stream).not.toHaveBeenCalled();
  });
  it("streams a preview and returns only committed validated PENDING suggestions", async () => {
    const response = await runWbs(); expect(response.headers.get("content-type")).toContain("text/event-stream");
    const output = await events(response); expect(output.some(event => event.event === "delta")).toBe(true);
    expect(output.filter(event => event.event === "result")).toHaveLength(1);
    const rows = await db.aiSuggestion.findMany({ where: { projectId } }); expect(rows).toHaveLength(3); expect(rows.every(row => row.status === "PENDING")).toBe(true);
    expect(await db.task.count({ where: { projectId } })).toBe(2);
    expect(await db.auditLog.count({ where: { projectId, action: "AI_WBS_GENERATED" } })).toBe(1);
  });
  it("sends UNAUTHORIZED and persists no suggestions after role revocation during the stream", async () => {
    state.stream.mockImplementation(async () => modelStream(tasks, async () => { await db.$transaction(tx => tx.user.update({ where: { id: actorId }, data: { role: "MEMBER" } })); }));
    const output = await events(await runWbs());
    expect(output.find(event => event.event === "error")).toMatchObject({ data: { code: "UNAUTHORIZED", status: 403 } });
    expect(output.some(event => event.event === "result")).toBe(false); expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
  });
  it("rolls back all generated suggestions when the generation audit fails", async () => {
    state.auditFailure = true; const output = await events(await runWbs());
    expect(output.some(event => event.event === "error")).toBe(true); expect(output.some(event => event.event === "result")).toBe(false);
    expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
  });
  it("propagates cancellation to the provider and does not retry or save", async () => {
    const abort = new AbortController(); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    state.stream.mockImplementation(async (_messages, options: { signal: AbortSignal }) => {
      const iterator = (async function* () { started(); yield { content: "<PUBLIC_PREVIEW>正在检查" }; await new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })); })();
      return Object.assign(iterator, { cancel: async () => { await iterator.return(undefined); } });
    });
    const result = generateWbsSuggestions({ projectId, actorId, sourceTaskId, request: "Synthetic refinement" }, { signal: abort.signal, generationId: randomUUID(), emit: () => {} });
    await ready; abort.abort(new DOMException("Cancelled", "AbortError"));
    await expect(result).rejects.toMatchObject({ name: "AbortError" }); expect(state.stream).toHaveBeenCalledTimes(1);
    expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
  });
  it("streams and stores a task-scoped compliance summary as PENDING", async () => {
    state.stream.mockImplementation(async () => modelStream(summary));
    const response = await compliance(request("/api/audit/summary", { projectId, taskId: complianceTaskId }));
    const output = await events(response); expect(output.some(event => event.event === "result")).toBe(true);
    const saved = await db.aiSuggestion.findFirstOrThrow({ where: { projectId, type: "AUDIT_SUMMARY" } }); expect(saved.status).toBe("PENDING");
  });
  it("cleans fragmented control tags before SSE deltas and real database writes", async () => {
    state.stream.mockImplementation(async () => {
      const dirty = JSON.parse(tasks); dirty.tasks[0].title = "<PUBLIC_PREVIEW>Clean title</PUBLIC_PREVIEW>";
      dirty.tasks[0].description = "Public<internal>private-secret</internal> delivery";
      const raw = `<PUBLIC_PREVIEW>Public<PUBLIC_PREVIEW> preview<internal>private-secret</internal><RESULT_JSON>${JSON.stringify(dirty)}`;
      const iterator = (async function* () { for (const content of raw.match(/[\s\S]{1,3}/g) || []) yield { content }; })();
      return Object.assign(iterator, { cancel: async () => { await iterator.return(undefined); } });
    });
    const output = await events(await runWbs());
    expect(output.filter(event => event.event === "delta").map(event => JSON.stringify(event.data)).join("")).not.toMatch(/PUBLIC_PREVIEW|internal|private-secret/);
    const rows = await db.aiSuggestion.findMany({ where: { projectId } }); expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toMatch(/PUBLIC_PREVIEW|internal|private-secret/);
    expect(await db.task.count({ where: { projectId } })).toBe(2);
  });
  it("emits two retry progress events then a friendly error with no partial suggestions", async () => {
    state.stream.mockImplementation(async () => {
      const call = state.stream.mock.calls.length;
      const iterator = (async function* () { yield { content: call === 1 ? '<PUBLIC_PREVIEW>Checking<RESULT_JSON>{"tasks":[]}' : '{"tasks":[]}' }; })();
      return Object.assign(iterator, { cancel: async () => { await iterator.return(undefined); } });
    });
    const output = await events(await runWbs());
    expect(output.filter(event => event.event === "progress" && (event.data as { stage?: string }).stage === "retrying")).toHaveLength(2);
    expect(output.find(event => event.event === "error")).toMatchObject({ data: { code: "MODEL_RESPONSE_INVALID", message: "当前需求描述可能过于复杂，AI 未能生成标准结构，请精简描述或手动创建。" } });
    expect(output.some(event => event.event === "result")).toBe(false); expect(state.stream).toHaveBeenCalledTimes(3);
    expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
  });
  it.each([1, 2])("aborting correction %i leaves no generated rows or success audit in MySQL", async attempt => {
    const abort = new AbortController(); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    state.stream.mockImplementation(async (_messages, options: { signal: AbortSignal }) => {
      const call = state.stream.mock.calls.length;
      const iterator = (async function* () {
        if (call === attempt + 1) {
          started(); await new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
        } else yield { content: call === 1 ? '<PUBLIC_PREVIEW>Checking<RESULT_JSON>{"tasks":[]}' : '{"tasks":[]}' };
      })();
      return Object.assign(iterator, { cancel: async () => { await iterator.return(undefined); } });
    });
    const result = generateWbsSuggestions({ projectId, actorId, sourceTaskId, request: "Synthetic refinement" }, { signal: abort.signal, generationId: randomUUID(), emit: () => {} });
    await ready; abort.abort(new DOMException("Cancelled", "AbortError"));
    await expect(result).rejects.toMatchObject({ name: "AbortError" }); expect(state.stream).toHaveBeenCalledTimes(attempt + 1);
    expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
    expect(await db.auditLog.count({ where: { projectId, action: "AI_WBS_GENERATED" } })).toBe(0);
  });
});
