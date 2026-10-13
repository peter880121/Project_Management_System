import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMilvusClient } from "@/modules/vector/client";
import { getObjectStorageClient } from "@/modules/documents/storage";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Check = "ok" | "error" | "not_configured";

async function check<T>(operation: () => Promise<T>): Promise<Check> {
  try {
    await operation();
    return "ok";
  } catch {
    return "error";
  }
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ status: "ok" });
  const denied = requireRole(user, ["ADMIN"]);
  if (denied) return denied;

  const mysql = await check(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  const milvus = process.env.MILVUS_ADDRESS
    ? await check(async () => {
        const response = await getMilvusClient().checkHealth();
        if (!response.isHealthy) throw new Error("Milvus reports unhealthy");
      })
    : ("not_configured" as const);
  const minio = process.env.MINIO_ENDPOINT
    ? await check(async () => {
        const bucket = process.env.MINIO_BUCKET;
        if (!bucket) throw new Error("MINIO_BUCKET is not configured");
        const exists = await getObjectStorageClient().bucketExists(bucket);
        if (!exists) throw new Error("Configured MinIO bucket does not exist");
      })
    : ("not_configured" as const);

  const checks = { mysql, milvus, minio };
  const healthy = Object.values(checks).every((status) => status === "ok");
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
