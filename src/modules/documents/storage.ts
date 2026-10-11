import { Client } from "minio";

export function getObjectStorageClient(): Client {
  const endpoint = process.env.MINIO_ENDPOINT;
  if (!endpoint) throw new Error("MINIO_ENDPOINT is not configured");
  return new Client({
    endPoint: endpoint,
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY ?? "",
    secretKey: process.env.MINIO_SECRET_KEY ?? "",
  });
}
