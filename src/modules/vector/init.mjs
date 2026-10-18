import "dotenv/config";
import { DataType, MilvusClient } from "@zilliz/milvus2-sdk-node";

const address = process.env.MILVUS_ADDRESS;
if (!address) throw new Error("MILVUS_ADDRESS is not configured");

const client = new MilvusClient({
  address: address.includes("://") ? address : `http://${address}`,
  ...(process.env.MILVUS_TOKEN ? { token: process.env.MILVUS_TOKEN } : {}),
});

const collectionName = "documents_v2";
const { value: exists } = await client.hasCollection({ collection_name: collectionName });

if (!exists) {
  await client.createCollection({
    collection_name: collectionName,
    enable_dynamic_field: false,
    fields: [
      { name: "id", data_type: DataType.VarChar, is_primary_key: true, max_length: 36 },
      { name: "docId", data_type: DataType.VarChar, max_length: 36 },
      { name: "documentId", data_type: DataType.VarChar, max_length: 36 },
      { name: "documentType", data_type: DataType.VarChar, max_length: 32 },
      { name: "visibleRoles", data_type: DataType.JSON },
      { name: "deliverableId", data_type: DataType.VarChar, max_length: 36 },
      { name: "projectId", data_type: DataType.VarChar, max_length: 36 },
      { name: "embedding", data_type: DataType.FloatVector, dim: 1536 },
      { name: "createdAt", data_type: DataType.Int64 },
    ],
  });
}

const { index_descriptions: indexes } = await client.describeIndex({
  collection_name: collectionName,
  field_name: "embedding",
});

if (indexes.length === 0) {
  await client.createIndex({
    collection_name: collectionName,
    field_name: "embedding",
    index_name: "documents_embedding_hnsw",
    index_type: "HNSW",
    metric_type: "COSINE",
    params: { M: 16, efConstruction: 200 },
  });
}

await client.loadCollection({ collection_name: collectionName });

const taskHistoryCollectionName = "task_history";
const { value: taskHistoryExists } = await client.hasCollection({ collection_name: taskHistoryCollectionName });

if (!taskHistoryExists) {
  await client.createCollection({
    collection_name: taskHistoryCollectionName,
    enable_dynamic_field: false,
    fields: [
      { name: "taskId", data_type: DataType.VarChar, is_primary_key: true, max_length: 36 },
      { name: "projectId", data_type: DataType.VarChar, max_length: 36 },
      { name: "embedding", data_type: DataType.FloatVector, dim: 1536 },
      { name: "indexedAt", data_type: DataType.Int64 },
    ],
  });
}

const { index_descriptions: taskHistoryIndexes } = await client.describeIndex({
  collection_name: taskHistoryCollectionName,
  field_name: "embedding",
});

if (taskHistoryIndexes.length === 0) {
  await client.createIndex({
    collection_name: taskHistoryCollectionName,
    field_name: "embedding",
    index_name: "task_history_embedding_hnsw",
    index_type: "HNSW",
    metric_type: "COSINE",
    params: { M: 16, efConstruction: 200 },
  });
}

await client.loadCollection({ collection_name: taskHistoryCollectionName });
