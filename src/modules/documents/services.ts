import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { documentStorage, type DocumentStorage } from "./storage";
import { DocumentError, validatePdf } from "./validation";
import * as repository from "./repositories";

type Actor = { actorId: string } & AuditRequestMetadata;
type Upload = { filename: string; mediaType: string; bytes: Buffer; uploadKey: string };
export async function uploadDocument(projectId: string, input: Upload, actor: Actor, storage: DocumentStorage = documentStorage) {
  const metadata = validatePdf(input.filename, input.mediaType, input.bytes);
  const started = await prisma.$transaction(async (tx) => {
    await repository.lockDocumentActor(tx, actor.actorId, true, projectId);
    if (!await repository.projectExists(tx, projectId)) throw new DocumentError("项目不存在", 404);
    const prior = await repository.findUpload(tx, projectId, input.uploadKey);
    if (prior) {
      if (prior.sha256 !== metadata.sha256 || prior.filename !== metadata.filename) throw new DocumentError("上传标识已用于其他文件", 409);
      if (prior.storageStatus === "AVAILABLE") return { document: prior, duplicate: true };
      throw new DocumentError("上传已记录，请刷新状态；中断记录可恢复，失败文件可重新上传", 409);
    }
    const id = randomUUID();
    const document = await repository.insertDocument(tx, { id, projectId, ...metadata, uploadedById: actor.actorId, uploadKey: input.uploadKey, minioKey: `projects/${projectId}/documents/${id}.pdf`, storageStatus: "UPLOADING" });
    await recordAudit(tx, { ...actor, projectId, action: "DOCUMENT_UPLOAD_STARTED", entityType: "Document", entityId: id, after: { ...metadata, storageStatus: "UPLOADING", syntheticOnlyConfirmed: true } });
    return { document, duplicate: false };
  });
  const row = started.document;
  if (started.duplicate) return { id: row.id, duplicate: true };
  try {
    await storage.put(row.minioKey, input.bytes, metadata.sha256);
    await prisma.$transaction(async (tx) => {
      await repository.lockDocumentActor(tx, actor.actorId, true, projectId);
      const changed = await repository.changeDocument(tx, { where: { id: row.id, storageStatus: "UPLOADING" }, data: { storageStatus: "AVAILABLE", uploadedAt: new Date(), errorCode: null } });
      if (changed.count !== 1) throw new DocumentError("上传状态已变化", 409);
      await recordAudit(tx, { ...actor, projectId, action: "DOCUMENT_UPLOADED", entityType: "Document", entityId: row.id, before: { storageStatus: "UPLOADING" }, after: { storageStatus: "AVAILABLE", sha256: metadata.sha256, fileSize: metadata.fileSize } });
    });
    return { id: row.id, duplicate: false };
  } catch {
    // A queued cleanup is durable before deletion; failed audit/DB leaves the original UPLOADING record for recovery.
    await prisma.$transaction(async (tx) => {
      await repository.lockDocumentActor(tx, actor.actorId, true, projectId);
      const changed = await repository.changeDocument(tx, { where: { id: row.id, storageStatus: "UPLOADING" }, data: { storageStatus: "FAILED", errorCode: "STORAGE_OR_CONFIRMATION_FAILED" } });
      if (changed.count !== 1) throw new DocumentError("上传状态已变化", 409);
      await repository.queueCleanup(tx, projectId, row.id, row.minioKey);
      await recordAudit(tx, { ...actor, projectId, action: "DOCUMENT_UPLOAD_FAILED", entityType: "Document", entityId: row.id, before: { storageStatus: "UPLOADING" }, after: { storageStatus: "FAILED", cleanupPending: true } });
    });
    await retryDocumentCleanup(row.id, actor, storage);
    throw new DocumentError("文档上传未完成，请检查存储服务后重新上传", 503);
  }
}
export async function retryDocumentCleanup(id: string, actor: Actor, storage: DocumentStorage = documentStorage) {
  const row = await repository.findDocument(id);
  if (!row) throw new DocumentError("文档不存在", 404);
  if (row.storageStatus !== "FAILED") throw new DocumentError("仅失败文档可清理对象", 409);
  await prisma.$transaction(async (tx) => {
    await repository.lockDocumentActor(tx, actor.actorId, true, row.projectId);
    await recordAudit(tx, { ...actor, projectId: row.projectId, action: "DOCUMENT_CLEANUP_RETRIED", entityType: "Document", entityId: id, after: { scope: "FAILED_UPLOAD_OBJECT", phase: "REQUESTED" } });
  });
  let removed = 0;
  let jobs = await repository.findCleanup(id);
  if (jobs.length === 0) {
    // FAILED documents remain discoverable even if a late remote write follows a previous cleanup.
    await prisma.$transaction((tx) => repository.queueCleanup(tx, row.projectId, id, row.minioKey));
    jobs = await repository.findCleanup(id);
  }
  for (const job of jobs) {
    try {
      if (row.minioKey !== `projects/${row.projectId}/documents/${row.id}.pdf`) throw new Error("Unexpected object key");
      await storage.remove(row.minioKey);
      await prisma.$transaction((tx) => repository.completeCleanup(tx, job.id)); removed++;
    } catch {
      await prisma.$transaction((tx) => repository.failCleanup(tx, job.id));
    }
  }
  return { removed };
}
export async function recoverDocument(id: string, actor: Actor, storage: DocumentStorage = documentStorage) {
  const row = await repository.findDocument(id);
  if (!row) throw new DocumentError("文档不存在", 404);
  if (row.storageStatus !== "UPLOADING" || row.updatedAt.getTime() > Date.now() - 10 * 60000) throw new DocumentError("仅超过 10 分钟的中断上传可恢复", 409);
  // Storage failure is not evidence that the object is absent; keep UPLOADING for another recovery attempt.
  let bytes: Buffer;
  try { bytes = await storage.get(row.minioKey); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code !== "NoSuchKey" && code !== "NotFound") throw new DocumentError("存储不可用，请稍后恢复", 503);
    bytes = Buffer.alloc(0);
  }
  const valid = bytes.length === row.fileSize && createHash("sha256").update(bytes).digest("hex") === row.sha256;
  await prisma.$transaction(async (tx) => {
    await repository.lockDocumentActor(tx, actor.actorId, true, row.projectId);
    const changed = await repository.changeDocument(tx, { where: { id, storageStatus: "UPLOADING", updatedAt: row.updatedAt }, data: { storageStatus: valid ? "AVAILABLE" : "FAILED", uploadedAt: valid ? new Date() : null, errorCode: valid ? null : "RECOVERY_OBJECT_INVALID" } });
    if (changed.count !== 1) throw new DocumentError("文档状态已变化", 409);
    if (!valid) await repository.queueCleanup(tx, row.projectId, id, row.minioKey);
    await recordAudit(tx, { ...actor, projectId: row.projectId, action: "DOCUMENT_UPLOAD_RECOVERED", entityType: "Document", entityId: id, before: { storageStatus: "UPLOADING" }, after: { storageStatus: valid ? "AVAILABLE" : "FAILED", sha256: row.sha256, fileSize: row.fileSize } });
  });
  return { id, storageStatus: valid ? "AVAILABLE" : "FAILED" };
}
export async function downloadDocument(id: string, actor: Actor, storage: DocumentStorage = documentStorage) {
  const row = await repository.findDocument(id);
  if (!row) throw new DocumentError("文档不存在", 404);
  if (row.storageStatus !== "AVAILABLE") throw new DocumentError("文档尚不可下载", 409);
  let bytes: Buffer;
  try { bytes = await storage.get(row.minioKey); }
  catch { throw new DocumentError("文档存储暂不可用", 503); }
  if (bytes.length !== row.fileSize || createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new DocumentError("文件完整性校验失败", 503);
  await prisma.$transaction(async (tx) => {
    await repository.lockDocumentActor(tx, actor.actorId, false, row.projectId);
    await recordAudit(tx, { ...actor, projectId: row.projectId, action: "DATA_EXPORTED", entityType: "Document", entityId: id, after: { scope: { projectId: row.projectId, documentIds: [id], filename: row.filename, sha256: row.sha256 }, exportedAt: new Date().toISOString() } });
  });
  return { bytes, filename: row.filename };
}
