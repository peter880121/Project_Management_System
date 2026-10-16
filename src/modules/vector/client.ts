import { MilvusClient } from "@zilliz/milvus2-sdk-node";

let client: MilvusClient | undefined;

/** The only module allowed to create or expose a Milvus SDK client. */
export function getMilvusClient(): MilvusClient {
  if (!client) {
    const address = process.env.MILVUS_ADDRESS;
    if (!address) throw new Error("MILVUS_ADDRESS is not configured");
    const created = new MilvusClient({
      address: address.includes("://") ? address : `http://${address}`,
      timeout: 5000,
      maxRetries: 0,
      logLevel: "error",
      ...(process.env.MILVUS_TOKEN ? { token: process.env.MILVUS_TOKEN } : {}),
    });
    client = created;
    // The SDK starts Connect in its constructor. Handle that independent promise
    // immediately, while keeping request failures visible to the calling adapter.
    void created.connectPromise.catch(async () => {
      if (client === created) client = undefined;
      try { await created.closeConnection(); }
      catch { console.error("Failed to close unavailable Milvus connection"); }
    });
  }
  return client;
}
