import { FROZEN_PROJECT_STATUSES } from "@/modules/projects/freeze";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { recordAudit } from "@/modules/audit/service";
import { lockProjectForWrite, lockUsers } from "@/modules/auth/transaction-locks";
import { getObjectStorageClient } from "@/modules/documents/storage";
export async function syncAssetSourceTick(put = async (key: string, bytes: Buffer, sha256: string) => {
  const bucket = process.env.MINIO_BUCKET; if (!bucket) throw new Error("Storage missing");
  await getObjectStorageClient().putObject(bucket, key, bytes, bytes.length, { "Content-Type": "text/markdown", "X-Amz-Meta-Sha256": sha256 });
}) {
  const job = await prisma.$transaction(async tx => {
    const now = new Date(); const item = await tx.assetSourceJob.findFirst({ where: { document: { project: { status: { notIn: [...FROZEN_PROJECT_STATUSES] } } }, status: { in: ["QUEUED", "RUNNING", "FAILED"] }, attempts: { lt: 5 }, nextRunAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, include: { document: true }, orderBy: { nextRunAt: "asc" } });
    if (!item) return null;
    await lockProjectForWrite(tx, item.document.projectId, true);
    const token = randomUUID();
    const changed = await tx.assetSourceJob.updateMany({ where: { id: item.id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }], status: { not: "COMPLETED" } }, data: { status: "RUNNING", leaseToken: token, leaseUntil: new Date(Date.now() + 60000) } });
    return changed.count ? { ...item, token } : null;
  }, { isolationLevel: "ReadCommitted" });
  if (!job) return false;
  let success = false;
  try { await put(job.document.minioKey, Buffer.from(job.document.parsedText ?? ""), job.document.sha256!); success = true; } catch { /* durable retry below; never log document contents */ }
  await prisma.$transaction(async tx => {
    await lockProjectForWrite(tx, job.document.projectId, true); await lockUsers(tx, [SYSTEM_USER_ID]);
    const changed = await tx.assetSourceJob.updateMany({ where: { id: job.id, leaseToken: job.token, leaseUntil: { gt: new Date() } }, data: { status: success ? "COMPLETED" : "FAILED", attempts: { increment: 1 }, nextRunAt: new Date(Date.now() + Math.min(300000, 10000 * 2 ** job.attempts)), leaseToken: null, leaseUntil: null } });
    if (!changed.count) return;
    if (success) {
      await tx.document.update({ where: { id: job.documentId }, data: { storageStatus: "AVAILABLE", uploadedAt: new Date() } });
      await tx.syncFailure.deleteMany({ where: { entityId: job.documentId, target: "ASSET_SOURCE_UPLOAD" } });
    } else {
      const old = await tx.syncFailure.findFirst({ where: { entityId: job.documentId, target: "ASSET_SOURCE_UPLOAD" } });
      if (old) await tx.syncFailure.update({ where: { id: old.id }, data: { retryCount: job.attempts + 1 } });
      else await tx.syncFailure.create({ data: { projectId: job.document.projectId, entityType: "Document", entityId: job.documentId, target: "ASSET_SOURCE_UPLOAD", payload: { documentId: job.documentId }, error: "MEETING_SOURCE_UPLOAD_FAILED", retryCount: job.attempts + 1 } });
    }
    await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: job.document.projectId, action: success ? "ASSET_SOURCE_SYNCED" : "ASSET_SOURCE_FAILED", entityType: "Document", entityId: job.documentId, after: { sha256: job.document.sha256, attempts: job.attempts + 1 } });
  });
  return true;
}
