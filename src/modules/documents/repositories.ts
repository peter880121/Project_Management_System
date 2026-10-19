import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DocumentError } from "./validation";
import { lockProject, lockProjectForWrite } from "@/modules/auth/transaction-locks";
export const publicDocumentSelect = { id: true, projectId: true, filename: true, mediaType: true, fileSize: true, sha256: true, storageStatus: true, errorCode: true, uploadedById: true, uploadedAt: true, createdAt: true, updatedAt: true, parseStatus: true, parseVersion: true, parsedVersion: true, parsedAt: true } satisfies Prisma.DocumentSelect;
export async function lockDocumentActor(tx: Prisma.TransactionClient, actorId: string, upload: boolean, projectId?: string) {
  if (projectId) { if (upload) await lockProjectForWrite(tx, projectId); else await lockProject(tx, projectId); }
  await tx.$queryRaw`SELECT id FROM User WHERE id = ${actorId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, status: true, isSystem: true } });
  if (!user || user.status !== "ACTIVE" || user.isSystem || (upload && !["PM", "ADMIN"].includes(user.role))) throw new DocumentError("账号无权执行此操作", 403);
}
export const findDocument = (id: string) => prisma.document.findUnique({ where: { id } });
export const findDocumentTx = (tx: Prisma.TransactionClient, id: string) => tx.document.findUnique({ where: { id } });
export const findUpload = (tx: Prisma.TransactionClient, projectId: string, uploadKey: string) => tx.document.findUnique({ where: { projectId_uploadKey: { projectId, uploadKey } } });
export const insertDocument = (tx: Prisma.TransactionClient, data: Prisma.DocumentUncheckedCreateInput) => tx.document.create({ data });
export const changeDocument = (tx: Prisma.TransactionClient, args: Prisma.DocumentUpdateManyArgs) => tx.document.updateMany(args);
export const queueCleanup = (tx: Prisma.TransactionClient, projectId: string, id: string, key: string) => tx.syncFailure.create({ data: { projectId, entityType: "Document", entityId: id, target: "MINIO_DOCUMENT_CLEANUP", payload: { minioKey: key }, error: "Object cleanup pending" } });
export const findCleanup = (id: string) => prisma.syncFailure.findMany({ where: { entityType: "Document", entityId: id, target: "MINIO_DOCUMENT_CLEANUP" }, take: 10 });
export const completeCleanup = (tx: Prisma.TransactionClient, id: string) => tx.syncFailure.deleteMany({ where: { id, target: "MINIO_DOCUMENT_CLEANUP" } });
export const failCleanup = (tx: Prisma.TransactionClient, id: string) => tx.syncFailure.update({ where: { id }, data: { retryCount: { increment: 1 } } });
export async function listDocuments(projectId: string, page: number, role = "MEMBER") {
  if (!await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })) throw new DocumentError("项目不存在", 404);
  return prisma.document.findMany({ where: { projectId, ...(role === "ADMIN" ? {} : { visibleRoles: { array_contains: role } }) }, select: publicDocumentSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 20 });
}
export const projectExists = (tx: Prisma.TransactionClient, id: string) => tx.project.findUnique({ where: { id }, select: { id: true } });
