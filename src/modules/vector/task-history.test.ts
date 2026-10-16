import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ hasCollection: vi.fn(), describeIndex: vi.fn(), loadCollection: vi.fn(), search: vi.fn(), upsert: vi.fn() }));
vi.mock("./client", () => ({ getMilvusClient: () => sdk }));
import { searchTaskHistory, upsertTaskHistoryVector } from "./task-history";
beforeEach(() => { vi.clearAllMocks(); sdk.hasCollection.mockResolvedValue({ value: true }); sdk.describeIndex.mockResolvedValue({ index_descriptions: [{}] }); sdk.loadCollection.mockResolvedValue(undefined); });
it("loads historical IDs from both flat and nested SDK results", async () => {
  const id = randomUUID(); const input = { projectId: randomUUID(), embedding: Array(1536).fill(0) };
  sdk.search.mockResolvedValueOnce({ status: { error_code: "Success" }, results: [{ taskId: id }] });
  expect(await searchTaskHistory(input)).toEqual([id]);
  sdk.search.mockResolvedValueOnce({ status: { error_code: "Success" }, results: [[{ taskId: id }]] });
  expect(await searchTaskHistory(input)).toEqual([id]);
});
it("rejects SDK errors and invalid upsert IDs instead of marking synchronization successful", async () => {
  const input = { projectId: randomUUID(), taskId: randomUUID(), embedding: Array(1536).fill(0) };
  sdk.upsert.mockResolvedValue({ status: { error_code: "UnexpectedError" } });
  await expect(upsertTaskHistoryVector(input)).rejects.toThrow("write failed");
  await expect(upsertTaskHistoryVector({ ...input, projectId: '" OR true' })).rejects.toThrow();
});
