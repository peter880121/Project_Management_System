import { MilvusClient } from "@zilliz/milvus2-sdk-node";

let client: MilvusClient | undefined;

/** The only module allowed to create or expose a Milvus SDK client. */
export function getMilvusClient(): MilvusClient {
  if (!client) {
    const address = process.env.MILVUS_ADDRESS;
    if (!address) throw new Error("MILVUS_ADDRESS is not configured");
    client = new MilvusClient({
      address: address.includes("://") ? address : `http://${address}`,
      ...(process.env.MILVUS_TOKEN ? { token: process.env.MILVUS_TOKEN } : {}),
    });
  }
  return client;
}
