import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { MilvusClient } from "@zilliz/milvus2-sdk-node";
// Explicit synthetic protocol verification; only remove the two IDs created here.
const client = new MilvusClient({ address: process.env.MILVUS_ADDRESS, ...(process.env.MILVUS_TOKEN ? { token: process.env.MILVUS_TOKEN } : {}) });
const collection_name = "documents_v2"; const projectId = randomUUID(); const ids = [randomUUID(), randomUUID()];
const embedding = Array(1536).fill(0); embedding[0] = 1;
try {
  const schema = await client.describeCollection({ collection_name });
  const fields = schema.schema.fields.map(f => f.name);
  for (const field of ["projectId", "documentId", "documentType", "visibleRoles", "deliverableId"]) if (!fields.includes(field)) throw new Error(`Missing metadata field ${field}`);
  const result = await client.upsert({ collection_name, data: ids.map((id, i) => ({ id, docId: id, documentId: id, projectId, documentType: i ? "DELIVERABLE" : "MEETING", visibleRoles: i ? ["PM", "QA", "MEMBER", "ADMIN"] : ["PM"], deliverableId: i ? randomUUID() : "", createdAt: Date.now(), embedding })) });
  if (result.status.error_code !== "Success") throw new Error("Synthetic upsert rejected");
  await client.flushSync({ collection_names: [collection_name] });
  const search = async (role, project = projectId) => {
    const response = await client.search({ collection_name, data: [embedding], anns_field: "embedding", limit: 10, filter: `projectId == "${project}" && JSON_CONTAINS(visibleRoles, "${role}")`, output_fields: ["id", "documentId", "documentType", "visibleRoles", "deliverableId"], metric_type: "COSINE", params: { ef: 128 }, consistency_level: "Strong" });
    if (response.status.error_code !== "Success") throw new Error("Synthetic search rejected");
    return response.results.flat();
  };
  const pm = await search("PM"); const qa = await search("QA"); const other = await search("PM", randomUUID());
  if (!pm.some(r => r.id === ids[0]) || !pm.some(r => r.id === ids[1]) || qa.some(r => r.id === ids[0]) || !qa.some(r => r.id === ids[1]) || other.length) throw new Error("Metadata isolation verification failed");
  writeFileSync("test-results/assets-milvus-verification.json", JSON.stringify({ collection: collection_name, fields, pmVisible: pm.length, qaVisible: qa.length, otherProjectVisible: other.length, metadata: pm.map(({ embedding: _embedding, ...r }) => r) }, null, 2));
  console.log("Milvus v2 metadata and project/role isolation verified");
} finally { await client.delete({ collection_name, ids }); await client.closeConnection(); }
