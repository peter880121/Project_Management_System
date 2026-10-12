import { DataType } from "@zilliz/milvus2-sdk-node";
import { getMilvusClient } from "./client";

export const TASK_HISTORY_COLLECTION = "task_history";
export const TASK_HISTORY_EMBEDDING_DIMENSION = 1536;

async function ensureTaskHistoryCollection() {
  const client = getMilvusClient();
  const { value: exists } = await client.hasCollection({ collection_name: TASK_HISTORY_COLLECTION });
  if (!exists) {
    await client.createCollection({
      collection_name: TASK_HISTORY_COLLECTION,
      enable_dynamic_field: false,
      fields: [
        { name: "taskId", data_type: DataType.VarChar, is_primary_key: true, max_length: 36 },
        { name: "projectId", data_type: DataType.VarChar, max_length: 36 },
        { name: "embedding", data_type: DataType.FloatVector, dim: TASK_HISTORY_EMBEDDING_DIMENSION },
        { name: "indexedAt", data_type: DataType.Int64 },
      ],
    });
  }
  const { index_descriptions: indexes } = await client.describeIndex({ collection_name: TASK_HISTORY_COLLECTION, field_name: "embedding" });
  if (indexes.length === 0) {
    await client.createIndex({
      collection_name: TASK_HISTORY_COLLECTION,
      field_name: "embedding",
      index_name: "task_history_embedding_hnsw",
      index_type: "HNSW",
      metric_type: "COSINE",
      params: { M: 16, efConstruction: 200 },
    });
  }
  await client.loadCollection({ collection_name: TASK_HISTORY_COLLECTION });
  return client;
}

export async function upsertTaskHistoryVector(input: { taskId: string; projectId: string; embedding: number[] }) {
  if (input.embedding.length !== TASK_HISTORY_EMBEDDING_DIMENSION) throw new Error("Task history embedding must have 1536 dimensions");
  const client = await ensureTaskHistoryCollection();
  await client.upsert({ collection_name: TASK_HISTORY_COLLECTION, data: [{
    taskId: input.taskId,
    projectId: input.projectId,
    embedding: input.embedding,
    indexedAt: Date.now(),
  }] });
}

/** Project IDs come from validated UUIDs; filtering stays inside the adapter. */
export async function searchTaskHistory(input: { projectId: string; embedding: number[]; limit?: number }): Promise<string[]> {
  if (input.embedding.length !== TASK_HISTORY_EMBEDDING_DIMENSION) throw new Error("Task history embedding must have 1536 dimensions");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.projectId)) throw new Error("Invalid project ID");
  const client = await ensureTaskHistoryCollection();
  const response = await client.search({
    collection_name: TASK_HISTORY_COLLECTION,
    data: [input.embedding],
    anns_field: "embedding",
    limit: input.limit ?? 8,
    filter: `projectId == "${input.projectId}"`,
    output_fields: ["taskId"],
    metric_type: "COSINE",
    params: { ef: 64 },
  });
  const hits = response.results[0] ?? [];
  return hits.flatMap((hit: { taskId?: unknown }) => typeof hit.taskId === "string" ? [hit.taskId] : []);
}
