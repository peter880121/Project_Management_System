import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { documentSearchSchema, retrieveDocumentEvidence, type RetrievalAdapters } from "./rag-service";
import { queryTerms, type ChunkEvidence } from "./rag-repositories";
const evidence: ChunkEvidence = { id: randomUUID(), documentId: randomUUID(), version: 1, ordinal: 0, text: "synthetic acceptance evidence", textSha256: "a".repeat(64), page: 2, blockIndex: 0, startOffset: 0, endOffset: 29, filename: "synthetic.pdf", parseJobId: randomUUID() };
const scope = { projectId: randomUUID() };
function adapters(): RetrievalAdapters {
  return { embed: vi.fn().mockResolvedValue([1]), search: vi.fn().mockResolvedValue([evidence.id]), load: vi.fn().mockResolvedValue([evidence]), keyword: vi.fn().mockResolvedValue([evidence]), timeoutMs: 1500 };
}
afterEach(() => vi.useRealTimers());
describe("document retrieval failure boundary", () => {
  it("returns current scoped vector evidence without keyword search", async () => {
    const deps = adapters(); const result = await retrieveDocumentEvidence(scope, "acceptance", 8, deps);
    expect(result).toMatchObject({ degraded: false, hitIds: [evidence.id], mode: "vector" });
    expect(deps.load).toHaveBeenCalledWith(scope, [evidence.id]); expect(deps.keyword).not.toHaveBeenCalled();
  });
  it("falls back within 1500ms while embedding hangs and never starts late vector search", async () => {
    vi.useFakeTimers(); const deps = adapters(); let release!: (value: number[]) => void;
    deps.embed = vi.fn(() => new Promise<number[]>((resolve) => { release = resolve; }));
    const pending = retrieveDocumentEvidence(scope, "acceptance", 8, deps);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toMatchObject({ degraded: true, reason: "VECTOR_TIMEOUT", durationMs: 1500, hitIds: [evidence.id] });
    release([1]); await vi.advanceTimersByTimeAsync(0); expect(deps.search).not.toHaveBeenCalled();
  });
  it("bounds a hanging vector call and does not backfill after keyword hits", async () => {
    vi.useFakeTimers(); const deps = adapters(); deps.search = vi.fn(() => new Promise<string[]>(() => {}));
    const pending = retrieveDocumentEvidence(scope, "acceptance", 8, deps); await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toMatchObject({ degraded: true, reason: "VECTOR_TIMEOUT" }); expect(deps.keyword).toHaveBeenCalledOnce(); expect(deps.load).not.toHaveBeenCalled();
  });
  it("falls back when vectors are stale, missing or unavailable", async () => {
    const deps = adapters(); deps.load = vi.fn().mockResolvedValue([]);
    expect(await retrieveDocumentEvidence(scope, "acceptance", 8, deps)).toMatchObject({ reason: "VECTOR_NO_CURRENT_HITS" });
    deps.embed = vi.fn().mockRejectedValue(new Error("secret remote message"));
    const result = await retrieveDocumentEvidence(scope, "acceptance", 8, deps);
    expect(result.reason).toBe("VECTOR_UNAVAILABLE"); expect(JSON.stringify(result)).not.toContain("secret remote");
  });
  it("validates version scoping and supports Chinese keyword fallback", () => {
    expect(documentSearchSchema.safeParse({ query: "abc", version: 1 }).success).toBe(false);
    expect(documentSearchSchema.safeParse({ query: "!!!" }).success).toBe(false);
    expect(queryTerms("需求验收测试")).toContain("验收");
    expect(documentSearchSchema.safeParse({ query: "abc", documentId: randomUUID(), version: 1 }).success).toBe(true);
  });
});
