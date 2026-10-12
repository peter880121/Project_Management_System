import { describe, expect, it, vi } from "vitest";
import { retrieveHistoricalTasks, type HistoryAdapters } from "./history";
import { containsLikelySensitiveInput, generateOrEmpty, parseWbsResponse, summarizeWbsInput } from "./service";
import type { HistoricalTask } from "./types";

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

  it("falls back to parameterized MySQL keyword matching when Milvus fails and indexes the matches", async () => {
    const search = adapters({ vectorSearch: vi.fn(async () => { throw new Error("Milvus unavailable"); }) });
    const result = await retrieveHistoricalTasks("00000000-0000-4000-8000-000000000065", "release workflow", search);
    expect(result.tasks).toEqual([historyTask]);
    expect(result.degraded).toBe(true);
    expect(search.keywordSearch).toHaveBeenCalledOnce();
    expect(search.indexFallbacks).toHaveBeenCalledOnce();
  });

  it("uses MySQL when Milvus has not indexed any historical task yet", async () => {
    const search = adapters({ vectorSearch: vi.fn(async () => []), loadByIds: vi.fn(async () => []) });
    const result = await retrieveHistoricalTasks("00000000-0000-4000-8000-000000000065", "release workflow", search);
    expect(result.degraded).toBe(true);
    expect(result.tasks).toEqual([historyTask]);
  });
});

describe("WBS output safety and LLM fallback", () => {
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
