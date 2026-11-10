import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ search: vi.fn(), upsert: vi.fn() }));
vi.mock("./client", () => ({ getMilvusClient: () => calls }));
vi.mock("./documents-collection", () => ({ DOCUMENTS_COLLECTION: "documents_v2", ensureDocumentsCollection: async () => {} }));
import { searchAssistantVectors, upsertDocumentVector } from "./documents";
const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002"; const vector = Array(1536).fill(0.1);
beforeEach(() => { vi.clearAllMocks(); calls.search.mockResolvedValue({ status: { error_code: "Success" }, results: [[{ id: a }, { id: "invalid" }]] }); calls.upsert.mockResolvedValue({ status: { error_code: "Success" } }); });
describe("assistant vector authorization metadata", () => {
  it("prefilters the server-resolved project set and PMO visibility", async () => { expect(await searchAssistantVectors([a, b], vector, "PMO")).toEqual([a]); const filter = calls.search.mock.calls[0][0].filter; expect(filter).toContain(`projectId in ["${a}","${b}"]`); expect(filter).toContain('JSON_CONTAINS(visibleRoles, "PMO")'); });
  it("rejects invalid or empty project scopes before calling Milvus", async () => { for (const ids of [[], ['x" OR true'], Array(1001).fill(a)]) await expect(searchAssistantVectors(ids, vector, "MEMBER")).rejects.toThrow(); expect(calls.search).not.toHaveBeenCalled(); });
  it("stores meeting attachment metadata without a collection rebuild", async () => { await upsertDocumentVector({ id: a, docId: b, projectId: a, embedding: vector, createdAt: new Date(), documentType: "MEETING_ATTACHMENT", visibleRoles: ["PMO"] }); expect(calls.upsert.mock.calls[0][0]).toMatchObject({ collection_name: "documents_v2", data: [{ documentType: "MEETING_ATTACHMENT", visibleRoles: ["PMO"], documentId: b }] }); });
});
