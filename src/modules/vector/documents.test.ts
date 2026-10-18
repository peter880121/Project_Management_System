import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ upsert: vi.fn(), search: vi.fn(), ensure: vi.fn() }));
vi.mock("./client", () => ({ getMilvusClient: () => mock }));
vi.mock("./documents-collection", () => ({ DOCUMENTS_COLLECTION: "documents", ensureDocumentsCollection: mock.ensure }));
import { searchDocumentVectors, upsertDocumentVector } from "./documents";
beforeEach(() => { vi.clearAllMocks(); mock.ensure.mockResolvedValue(undefined); });
it("normalizes flat and nested SDK hits and rejects invalid filters", async () => {
  const id = randomUUID(); const projectId = randomUUID();
  mock.search.mockResolvedValueOnce({ status: { error_code: "Success" }, results: [{ id }] });
  expect(await searchDocumentVectors(projectId, Array(1536).fill(0))).toEqual([id]);
  mock.search.mockResolvedValueOnce({ status: { error_code: "Success" }, results: [[{ id }]] });
  expect(await searchDocumentVectors(projectId, Array(1536).fill(0))).toEqual([id]);
  await expect(searchDocumentVectors('" OR true', Array(1536).fill(0))).rejects.toThrow();
});
it("checks write status rather than treating non-throwing SDK errors as success", async () => {
  const input = { id: randomUUID(), docId: randomUUID(), projectId: randomUUID(), embedding: Array(1536).fill(0), createdAt: new Date() };
  mock.upsert.mockResolvedValueOnce({ status: { error_code: "Success" } }); await upsertDocumentVector(input);
  mock.upsert.mockResolvedValueOnce({ status: { error_code: "UnexpectedError" } }); await expect(upsertDocumentVector(input)).rejects.toThrow();
});
it("writes complete asset metadata and pushes role filters down to Milvus", async () => {
  const input = { id: randomUUID(), docId: randomUUID(), projectId: randomUUID(), embedding: Array(1536).fill(0), createdAt: new Date(), documentType: "DELIVERABLE", visibleRoles: ["PM", "QA"], deliverableId: randomUUID() };
  mock.upsert.mockResolvedValue({ status: { error_code: "Success" } }); await upsertDocumentVector(input);
  expect(mock.upsert).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ projectId: input.projectId, documentId: input.docId, documentType: "DELIVERABLE", visibleRoles: ["PM", "QA"], deliverableId: input.deliverableId })] }));
  mock.search.mockResolvedValue({ status: { error_code: "Success" }, results: [] });
  await searchDocumentVectors(input.projectId, input.embedding, undefined, "QA");
  expect(mock.search).toHaveBeenLastCalledWith(expect.objectContaining({ filter: `projectId == "${input.projectId}" && JSON_CONTAINS(visibleRoles, "QA")` }));
  await expect(searchDocumentVectors(input.projectId, input.embedding, undefined, 'QA" || true')).rejects.toThrow();
});
