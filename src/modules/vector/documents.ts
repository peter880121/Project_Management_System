import { z } from "zod";
import { getMilvusClient } from "./client";
import { DOCUMENTS_COLLECTION, ensureDocumentsCollection } from "./documents-collection";

function vector(value: number[]) {
  if (value.length !== 1536 || value.some((item) => !Number.isFinite(item))) throw new Error("Invalid document vector");
}
export async function upsertDocumentVector(input: { id: string; docId: string; projectId: string; embedding: number[]; createdAt: Date; documentType?: string; visibleRoles?: string[]; deliverableId?: string }) {
  z.uuid().parse(input.id); z.uuid().parse(input.docId); z.uuid().parse(input.projectId); vector(input.embedding);
  await ensureDocumentsCollection();
  const visibleRoles = z.array(z.enum(["ADMIN", "PM", "MEMBER", "QA"])).min(1).parse(input.visibleRoles ?? ["ADMIN", "PM", "MEMBER", "QA"]);
  if (input.deliverableId) z.uuid().parse(input.deliverableId);
  const documentType = z.enum(["DOCUMENT", "DELIVERABLE", "MEETING"]).parse(input.documentType ?? "DOCUMENT");
  const result = await getMilvusClient().upsert({ collection_name: DOCUMENTS_COLLECTION, data: [{ ...input, documentId: input.docId, documentType, visibleRoles, deliverableId: input.deliverableId ?? "", createdAt: input.createdAt.getTime() }] });
  if (result.status.error_code !== "Success") throw new Error("Document vector write failed");
}
export async function searchDocumentVectors(projectId: string, embedding: number[], documentId?: string, actorRole = "MEMBER"): Promise<string[]> {
  z.uuid().parse(projectId); if (documentId) z.uuid().parse(documentId); vector(embedding);
  await ensureDocumentsCollection();
  const role = z.enum(["ADMIN", "PM", "MEMBER", "QA"]).parse(actorRole);
  const response = await getMilvusClient().search({ collection_name: DOCUMENTS_COLLECTION, data: [embedding], anns_field: "embedding", limit: 64,
    filter: `projectId == "${projectId}"${documentId ? ` && docId == "${documentId}"` : ""}${role === "ADMIN" ? "" : ` && JSON_CONTAINS(visibleRoles, "${role}")`}`, output_fields: ["id"], metric_type: "COSINE", params: { ef: 128 } });
  if (response.status.error_code !== "Success") throw new Error("Document vector search failed");
  // SDK versions expose flat or nested results. Normalize both shapes.
  const hits = response.results.flat();
  return hits.flatMap((hit) => typeof hit.id === "string" && z.uuid().safeParse(hit.id).success ? [hit.id] : []);
}
