import { randomUUID, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { documentStorage, type DocumentStorage } from "@/modules/documents/storage";
import type { AuditRequestMetadata } from "@/modules/audit/service";
import { recordAudit } from "@/modules/audit/service";
import { assertProjectAccessTx, ProjectAccessError } from "@/modules/auth/project-access";
import { lockProject, lockUsers } from "@/modules/auth/transaction-locks";
import { ProjectError } from "@/modules/projects/services";
import { lockRequirementActor } from "./services";
import { attachmentSelect } from "./repositories";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 8;
type Actor = { actorId: string } & AuditRequestMetadata;
type Target = { requirementId: string; intakeId?: never } | { intakeId: string; requirementId?: never };
export function validateRequirementImage(filename: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ProjectError("每张图片需在 5 MB 以内", 400);
  if (!filename || filename.length > 191 || /[\x00-\x1f\x7f/\\]/.test(filename)) throw new ProjectError("图片文件名无效", 400);
  const png = bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR";
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  const webp = bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16));
  if (png && /\.png$/i.test(filename)) return { extension: "png", mediaType: "image/png" };
  if (jpeg && /\.jpe?g$/i.test(filename)) return { extension: "jpg", mediaType: "image/jpeg" };
  if (webp && /\.webp$/i.test(filename)) return { extension: "webp", mediaType: "image/webp" };
  throw new ProjectError("仅支持真实的 PNG、JPEG、WebP 图片，不支持 SVG 或伪装文件", 400);
}
export async function uploadRequirementImage(projectId: string, target: Target, input: { filename: string; bytes: Buffer; expectedRowVersion: number }, actor: Actor, storage: DocumentStorage = documentStorage) {
  const format = validateRequirementImage(input.filename, input.bytes); const id = randomUUID();
  const minioKey = `projects/${projectId}/requirements/${id}.${format.extension}`; const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  // Object IO is outside the project lock. Commit rechecks scope, permission,
  // draft state, optimistic version and count; failed commits compensate storage.
  await prisma.$transaction(async tx => {
    const user = await lockRequirementActor(tx, projectId, actor, target.requirementId ? ["PM", "ADMIN"] : ["PM", "ADMIN", "QA", "MEMBER"]);
    if (target.requirementId) {
      if (!await tx.requirement.count({ where: { id: target.requirementId, projectId, managed: true, workflowState: "DRAFT", rowVersion: input.expectedRowVersion } })) throw new ProjectError("需求已变化或已提交评审，请刷新后再上传", 409);
    } else if (!await tx.requirementIntake.count({ where: { id: target.intakeId, projectId, state: { in: ["SUBMITTED", "CLARIFYING"] }, rowVersion: input.expectedRowVersion, ...(!["PM", "ADMIN"].includes(user.role) ? { createdById: actor.actorId } : {}) } })) throw new ProjectError("诉求不存在、已处理或无权上传", 403);
  });
  try {
    await storage.put(minioKey, input.bytes, sha256, format.mediaType);
    return await prisma.$transaction(async tx => {
      const user = await lockRequirementActor(tx, projectId, actor, target.requirementId ? ["PM", "ADMIN"] : ["PM", "ADMIN", "QA", "MEMBER"]);
      let revisionId: string | null = null;
      if (target.requirementId) {
        const req = await tx.requirement.findFirst({ where: { id: target.requirementId, projectId, managed: true, workflowState: "DRAFT", rowVersion: input.expectedRowVersion } });
        if (!req) throw new ProjectError("需求已变化或已提交评审，请刷新后再上传", 409);
        revisionId = (await tx.requirementRevision.findUniqueOrThrow({ where: { requirementId_version: { requirementId: req.id, version: req.draftVersion! } } })).id;
      } else {
        const intake = await tx.requirementIntake.findFirst({ where: { id: target.intakeId, projectId, state: { in: ["SUBMITTED", "CLARIFYING"] }, rowVersion: input.expectedRowVersion } });
        if (!intake || !["PM", "ADMIN"].includes(user.role) && intake.createdById !== actor.actorId) throw new ProjectError("诉求已变化或无权上传", 403);
      }
      if (await tx.requirementAttachment.count({ where: { projectId, ...target } }) >= MAX_IMAGES) throw new ProjectError("每条需求或诉求最多上传 8 张图片", 400);
      const image = await tx.requirementAttachment.create({ data: { id, projectId, ...target, revisionId, filename: input.filename, minioKey, sha256, fileSize: input.bytes.length, mediaType: format.mediaType, createdById: actor.actorId }, select: attachmentSelect });
      if (target.requirementId) await tx.requirement.update({ where: { id: target.requirementId }, data: { rowVersion: { increment: 1 } } });
      else await tx.requirementIntake.update({ where: { id: target.intakeId }, data: { rowVersion: { increment: 1 } } });
      await recordAudit(tx, { ...actor, projectId, action: "REQUIREMENT_IMAGE_UPLOADED", entityType: target.requirementId ? "Requirement" : "RequirementIntake", entityId: target.requirementId ?? target.intakeId!, after: { imageId: id, sha256, filename: input.filename, fileSize: input.bytes.length, revisionId } }); return image;
    }, { timeout: 15000 });
  } catch (error) {
    try { await storage.remove(minioKey); } catch { console.warn("REQUIREMENT_IMAGE_STORAGE_CLEANUP_REQUIRED", { imageId: id }); }
    if (error instanceof ProjectError || error instanceof ProjectAccessError || error instanceof Error && "projectStatus" in error) throw error;
    throw new ProjectError("图片上传失败，请稍后重试", 503);
  }
}
export async function readRequirementImage(projectId: string, id: string, actor: Actor, storage: DocumentStorage = documentStorage) {
  const image = await prisma.$transaction(async tx => {
    // Read operations remain available after archive and never use a write guard.
    await lockProject(tx, projectId); await lockUsers(tx, [actor.actorId]); await assertProjectAccessTx(tx, actor.actorId, projectId);
    const row = await tx.requirementAttachment.findFirst({ where: { id, projectId } }); if (!row) throw new ProjectError("图片不存在", 404); return row;
  });
  const bytes = await storage.get(image.minioKey);
  if (createHash("sha256").update(bytes).digest("hex") !== image.sha256) throw new ProjectError("图片完整性校验失败", 409);
  return { image, bytes };
}
