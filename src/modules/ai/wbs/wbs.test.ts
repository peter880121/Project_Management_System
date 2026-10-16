import { describe, expect, it, vi } from "vitest";
import { retrieveHistoricalTasks, type HistoryAdapters } from "./history";
import { containsLikelySensitiveInput, generateOrEmpty, parseWbsResponse, summarizeWbsInput } from "./service";
import type { HistoricalTask } from "./types";
import { storedDocumentEvidence, type WbsDocumentEvidence } from "./types";

const historyTask: HistoricalTask = {
  id: "00000000-0000-4000-8000-000000000101",
  title: "Verify release workflow",
  description: "Synthetic acceptance testing task",
  actualHours: 6.5,
  deliveryDays: 4,
};

function adapters(overrides: Partial<HistoryAdapters> = {}): HistoryAdapters {
  return {
    embed: vi.fn(async () => [0.1, 0.2]),
    vectorSearch: vi.fn(async () => [historyTask.id]),
    loadByIds: vi.fn(async () => [historyTask]),
    keywordSearch: vi.fn(async () => [historyTask]),
    indexFallbacks: vi.fn(async () => undefined),
    enqueueFallbacks: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("WBS history retrieval", () => {
  it("returns project-filtered vector hits and factual work measurements", async () => {
    const search = adapters();
    const result = await retrieveHistoricalTasks("00000000-0000-4000-8000-000000000065", "release workflow", search);
    expect(result.tasks).toEqual([historyTask]);
    expect(result.hitIds).toEqual([historyTask.id]);
    expect(result.degraded).toBe(false);
    expect(search.vectorSearch).toHaveBeenCalledOnce();
  });

  it("falls back to MySQL when Milvus fails and queues matches without vector writes", async () => {
    const search = adapters({ vectorSearch: vi.fn(async () => { throw new Error("Milvus unavailable"); }) });
    const result = await retrieveHistoricalTasks("00000000-0000-4000-8000-000000000065", "release workflow", search);
    expect(result.tasks).toEqual([historyTask]);
    expect(result.degraded).toBe(true);
    expect(search.keywordSearch).toHaveBeenCalledOnce();
    expect(search.enqueueFallbacks).toHaveBeenCalledOnce();
    expect(search.indexFallbacks).not.toHaveBeenCalled();
  });

  it("returns keyword results when embedding hangs without awaiting a hung vector writer", async () => {
    vi.useFakeTimers();
    try {
      const search = adapters({ embed: vi.fn(() => new Promise<number[]>(() => {})), indexFallbacks: vi.fn(() => new Promise<void>(() => {})), retrievalTimeoutMs: 25 });
      const pending = retrieveHistoricalTasks("00000000-0000-4000-8000-000000000065", "release", search);
      await vi.advanceTimersByTimeAsync(25);
      expect(await pending).toMatchObject({ tasks: [historyTask], degraded: true, durationMs: 25 });
      expect(search.enqueueFallbacks).toHaveBeenCalledOnce();
      expect(search.indexFallbacks).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("falls back when Milvus hangs and ignores its late failure", async () => {
    vi.useFakeTimers();
    try {
      let failSearch!: (reason: Error) => void;
      const search = adapters({ vectorSearch: vi.fn(() => new Promise<string[]>((_resolve, reject) => { failSearch = reject; })), retrievalTimeoutMs: 25 });
      const pending = retrieveHistoricalTasks("00000000-0000-4000-8000-000000000065", "release", search);
      await vi.advanceTimersByTimeAsync(25);
      expect(await pending).toMatchObject({ tasks: [historyTask], degraded: true });
      failSearch(new Error("late Milvus failure"));
      await vi.advanceTimersByTimeAsync(1);
      expect(search.indexFallbacks).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("uses MySQL when Milvus has not indexed any historical task yet", async () => {
    const search = adapters({ vectorSearch: vi.fn(async () => []), loadByIds: vi.fn(async () => []) });
    const result = await retrieveHistoricalTasks("00000000-0000-4000-8000-000000000065", "release workflow", search);
    expect(result.degraded).toBe(true);
    expect(result.tasks).toEqual([historyTask]);
  });
});

describe("WBS output safety and LLM fallback", () => {
  it("sends versioned document evidence and validates every cited chunk against that context", async () => {
    const source: WbsDocumentEvidence = { id: "00000000-0000-4000-8000-000000000111", documentId: "00000000-0000-4000-8000-000000000112", version: 2, page: 3, text: "Synthetic acceptance criteria", textSha256: "a".repeat(64), filename: "synthetic.pdf" };
    const task = { title: "Verify criteria", description: "Verify synthetic acceptance criteria", estimateHours: 3, dependencies: [], suggestedRole: "QA", sourceChunkIds: [source.id] };
    const invoke = vi.fn(async (prompt: string) => { expect(JSON.parse(prompt).documentEvidence).toEqual([source]); return JSON.stringify({ tasks: [task] }); });
    expect((await generateOrEmpty("Plan release", [historyTask], invoke, [source])).tasks[0].sourceChunkIds).toEqual([source.id]);
    const invented = await generateOrEmpty("Plan release", [], async () => JSON.stringify({ tasks: [{ ...task, sourceChunkIds: [historyTask.id] }] }), [source]);
    expect(invented.tasks).toEqual([]); expect(invented.error).toContain("outside the supplied evidence");
    expect(storedDocumentEvidence({ documentEvidence: [source] })).toEqual([source]);
    expect(storedDocumentEvidence({ retrievalHitIds: [] })).toEqual([]);
  });
  it("builds suggestions from a mocked LangChain response and includes observed history", async () => {
    const invoke = vi.fn(async (prompt: string) => {
      const context = JSON.parse(prompt) as { request: string; completedTaskHistory: { actualHours: number; deliveryDays: number }[] };
      expect(context.request).toContain("release readiness");
      expect(context.completedTaskHistory[0]).toMatchObject({ actualHours: 6.5, deliveryDays: 4 });
      return JSON.stringify({ tasks: [{ title: "Review release criteria", description: "Review synthetic criteria and traceability.", estimateHours: 3, dependencies: [], suggestedRole: "QA" }] });
    });
    const result = await generateOrEmpty("Plan synthetic release readiness", [historyTask], invoke);
    expect(result.error).toBeUndefined();
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ title: "Review release criteria", estimateHours: 3, suggestedRole: "QA" });
  });

  it("validates machine output and rejects cyclic dependencies", () => {
    expect(() => parseWbsResponse(JSON.stringify({ tasks: [
      { title: "A", description: "First", estimateHours: 2, dependencies: [1], suggestedRole: "MEMBER" },
      { title: "B", description: "Second", estimateHours: 3, dependencies: [0], suggestedRole: "QA" },
    ] }))).toThrow();
  });

  it("returns no suggestions when the LLM call fails", async () => {
    const result = await generateOrEmpty("Break down synthetic release requirement", [historyTask], vi.fn(async () => { throw new Error("provider offline"); }));
    expect(result.tasks).toEqual([]);
    expect(result.error).toBe("provider offline");
  });

  it("redacts contact-like identifiers from persisted summaries", () => {
    expect(summarizeWbsInput("Synthetic task for test@example.test, call 123-456-7890")).toBe("Synthetic task for [redacted-email], call [redacted-number]");
    expect(containsLikelySensitiveInput("Patient MRN: ABC-123456")).toBe(true);
    expect(containsLikelySensitiveInput("Synthetic appointment reminder workflow, no real contact data")).toBe(false);
  });
});
