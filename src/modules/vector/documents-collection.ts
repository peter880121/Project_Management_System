import { DataType } from "@zilliz/milvus2-sdk-node";
import { getMilvusClient } from "./client";

export const DOCUMENTS_COLLECTION = "documents";
export const DOCUMENT_EMBEDDING_DIMENSION = 1536;

/** Create the shared documents collection and its cosine HNSW index once. */
export async function ensureDocumentsCollection(): Promise<void> {
  const client = getMilvusClient();
  const { value: exists } = await client.hasCollection({
    collection_name: DOCUMENTS_COLLECTION,
  });

  if (!exists) {
    await client.createCollection({
      collection_name: DOCUMENTS_COLLECTION,
      enable_dynamic_field: false,
      fields: [
        { name: "id", data_type: DataType.VarChar, is_primary_key: true, max_length: 36 },
        { name: "docId", data_type: DataType.VarChar, max_length: 36 },
        { name: "projectId", data_type: DataType.VarChar, max_length: 36 },
        { name: "embedding", data_type: DataType.FloatVector, dim: DOCUMENT_EMBEDDING_DIMENSION },
        { name: "createdAt", data_type: DataType.Int64 },
      ],
    });
    await client.createIndex({
      collection_name: DOCUMENTS_COLLECTION,
      field_name: "embedding",
      index_type: "HNSW",
      metric_type: "COSINE",
      params: { M: 16, efConstruction: 200 },
    });
  }

  await client.loadCollection({ collection_name: DOCUMENTS_COLLECTION });
}
