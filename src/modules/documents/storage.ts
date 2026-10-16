import { Client } from "minio";
import * as http from "node:http";
import * as https from "node:https";
import { MAX_PDF_BYTES } from "./validation";

export function getObjectStorageClient(): Client {
  const endpoint = process.env.MINIO_ENDPOINT;
  if (!endpoint) throw new Error("MINIO_ENDPOINT is not configured");
  const useSSL = process.env.MINIO_USE_SSL === "true";
  const base = useSSL ? https : http;
  const request = (options: http.RequestOptions | string | URL, optionsOrCallback?: http.RequestOptions | ((response: http.IncomingMessage) => void), callback?: (response: http.IncomingMessage) => void) => {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    const req = typeof options === "string" || options instanceof URL ? base.request(options, typeof optionsOrCallback === "object" ? optionsOrCallback : {}, cb) : base.request(options, cb);
    const timer = setTimeout(() => req.destroy(new Error("Storage request timed out")), 15000);
    req.once("close", () => clearTimeout(timer));
    return req;
  };
  const client = new Client({
    endPoint: endpoint,
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL,
    transport: { request },
    retryOptions: { disableRetry: true },
    accessKey: process.env.MINIO_ACCESS_KEY ?? "",
    secretKey: process.env.MINIO_SECRET_KEY ?? "",
  });
  return client;
}

export type DocumentStorage = {
  put: (key: string, bytes: Buffer, sha256: string) => Promise<void>;
  get: (key: string) => Promise<Buffer>;
  remove: (key: string) => Promise<void>;
};
const bucket = () => {
  const value = process.env.MINIO_BUCKET;
  if (!value) throw new Error("MINIO_BUCKET is not configured");
  return value;
};
export const documentStorage: DocumentStorage = {
  async put(key, bytes, sha256) { await getObjectStorageClient().putObject(bucket(), key, bytes, bytes.length, { "Content-Type": "application/pdf", "X-Amz-Meta-Sha256": sha256 }); },
  async get(key) {
    const stream = await getObjectStorageClient().getObject(bucket(), key);
    const chunks: Buffer[] = []; let total = 0;
    try {
      for await (const part of stream) {
        const chunk = Buffer.from(part); total += chunk.length;
        if (total > MAX_PDF_BYTES) throw new Error("Object exceeds PDF limit");
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } finally { stream.destroy(); }
  },
  async remove(key) { await getObjectStorageClient().removeObject(bucket(), key); },
};
export const parseArtifactStorage = {
  async put(key: string, bytes: Buffer, sha256: string) { await getObjectStorageClient().putObject(bucket(), key, bytes, bytes.length, { "Content-Type": "application/zip", "X-Amz-Meta-Sha256": sha256 }); },
  remove: documentStorage.remove,
};
export const complianceExportStorage: DocumentStorage = {
  ...documentStorage,
  async put(key, bytes, sha256) { await getObjectStorageClient().putObject(bucket(), key, bytes, bytes.length, { "Content-Type": "application/octet-stream", "X-Amz-Meta-Sha256": sha256 }); },
};
