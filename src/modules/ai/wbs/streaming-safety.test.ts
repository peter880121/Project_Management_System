import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ stream: vi.fn(), create: vi.fn(), transaction: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/modules/auth/project-access", () => ({ lockBusinessActor: vi.fn() }));
vi.mock("@/modules/audit/service", () => ({ recordAudit: mocks.audit, recordRagSearch: vi.fn() }));
vi.mock("@/modules/ai/chat-model", () => ({ getConfiguredLlm: () => ({ provider: "openai", modelName: "synthetic", model: { stream: mocks.stream } }) }));
vi.mock("./history", () => ({ retrieveHistoricalTasks: async () => ({ tasks: [], hitIds: [], durationMs: 1, degraded: false }) }));
vi.mock("@/modules/documents/rag-service", () => ({ searchProjectDocuments: async () => ({ hits: [], hitIds: [], degraded: false, durationMs: 1 }) }));
import { generateWbsSuggestions, parseWbsResponse } from "./service";
import { wbsFailureMessage, WbsStructuredOutputError } from "./failure";
import { safeStreamError } from "../streaming/response";
import { WBS_JSON_EXAMPLE } from "./prompt";
import type { AiStreamEvent } from "../streaming/protocol";

const input = { projectId: "synthetic-project", actorId: "synthetic-pm", request: "Synthetic delivery scope" };
const valid = JSON.stringify({ tasks: [{ title: "<PUBLIC_PREVIEW>合成任务</PUBLIC_PREVIEW>", description: "公开<internal>private-secret</internal>交付", estimateHours: 2, dependencies: [], suggestedRole: "QA" }] });
function chunks(raw: string) {
  const iterator = (async function* () { for (const value of raw.match(/[\s\S]{1,3}/g) ?? []) yield { content: value }; })();
  return Object.assign(iterator, { cancel: vi.fn(async () => { await iterator.return(undefined); }) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.stream.mockReset();
  mocks.create.mockImplementation(async ({ data }) => data);
  mocks.transaction.mockImplementation(async callback => callback({ aiSuggestion: { create: mocks.create } }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it("cleans fragmented previews and the actual persisted suggestion output", async () => {
  mocks.stream.mockResolvedValue(chunks(`<PUBLIC_PREVIEW>公开<PUBLIC_PREVIEW>说明<internal>hidden</internal><RESULT_JSON>${valid}`));
  const events: AiStreamEvent[] = [];
  const result = await generateWbsSuggestions(input, { generationId: "id", signal: new AbortController().signal, emit: event => events.push(event) });
  expect(events.filter(event => event.event === "delta").map(event => event.data.text).join("")).toBe("公开说明");
  expect(result.suggestions[0].output).toMatchObject({ title: "合成任务", description: "公开交付" });
  expect(mocks.create.mock.calls[0][0].data.output).toMatchObject({ title: "合成任务", description: "公开交付" });
  expect(mocks.create.mock.calls[0][0].data.status).toBe("PENDING");
});
it("retries exactly twice, signals retry progress and returns the friendly fallback with zero suggestions", async () => {
  mocks.stream.mockImplementation(async () => chunks("Invalid model output"));
  const events: AiStreamEvent[] = [];
  const result = await generateWbsSuggestions(input, { generationId: "id", signal: new AbortController().signal, emit: event => events.push(event) });
  expect(mocks.stream).toHaveBeenCalledTimes(3); expect(mocks.create).not.toHaveBeenCalled();
  expect(result).toMatchObject({ manualFallback: true, failureCode: "MODEL_RESPONSE_INVALID", suggestions: [] });
  expect(events.filter(event => event.event === "progress" && event.data.stage === "retrying")).toHaveLength(2);
  expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "AI_WBS_GENERATION_FAILED", after: expect.objectContaining({ correctionAttempts: 2 }) }));
  const message = "当前需求描述可能过于复杂，AI 未能生成标准结构，请精简描述或手动创建。";
  expect(wbsFailureMessage(result.failureCode)).toBe(message);
  expect(safeStreamError(new WbsStructuredOutputError())).toMatchObject({ data: { code: "MODEL_RESPONSE_INVALID", message, retryable: false } });
});
it.each([1, 2])("aborts immediately during correction %i without another attempt or persistence", async attempt => {
  const abort = new AbortController(); let reached!: () => void; const ready = new Promise<void>(resolve => { reached = resolve; });
  let calls = 0; let providerSignal: AbortSignal | undefined;
  mocks.stream.mockImplementation(async (_messages, options: { signal: AbortSignal }) => {
    calls++;
    if (calls <= attempt) return chunks("Invalid model output");
    providerSignal = options.signal;
    const iterator = (async function* () { reached(); await new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }); }); yield { content: "never" }; })();
    return Object.assign(iterator, { cancel: async () => { await iterator.return(undefined); } });
  });
  const pending = generateWbsSuggestions(input, { generationId: "id", signal: abort.signal, emit: () => {} });
  await ready; abort.abort(new DOMException("Stopped", "AbortError"));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(providerSignal?.aborted).toBe(true); expect(calls).toBe(attempt + 1);
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
});
it("uses schema-valid few-shot JSON with no invented references", () => {
  const example = WBS_JSON_EXAMPLE.split("\n").find(line => line.startsWith("{"))!;
  expect(parseWbsResponse(example).tasks).toHaveLength(3);
  expect(() => parseWbsResponse(`<internal>${example}</internal>`)).toThrow();
});
