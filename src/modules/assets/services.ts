import { randomUUID, createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockBusinessActor, assertProjectAccessTx } from "@/modules/auth/project-access";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { mineruModel } from "@/modules/documents/mineru";
import { AssetError, canReadRoles, type deliverableCreateSchema, type meetingSchema } from "./validation";
import type { z } from "zod";
type Actor = { actorId: string } & AuditRequestMetadata;
const readers = ["ADMIN", "PM", "QA", "MEMBER"] as const;
export async function lockAssetActor(tx: Prisma.TransactionClient, projectId: string, actor: Actor, roles: readonly (typeof readers)[number][]) {
  const user = await lockBusinessActor(tx, actor.actorId, roles, projectId); await assertProjectAccessTx(tx, actor.actorId, projectId); return user;
}
export const evidenceSelect = { id: true, filename: true, sha256: true, fileSize: true, storageStatus: true, parseStatus: true, parsedVersion: true, chunkedVersion: true, mediaType: true } satisfies Prisma.DocumentSelect;
export async function assetIndexStatus(documentId: string | null) {
  if (!documentId) return "NOT_SYNCED";
  const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { assetJob: true } });
  if (!doc) return "NOT_SYNCED";
  const [failed, counts] = await Promise.all([prisma.syncFailure.count({ where: { OR: [{ entityId: documentId, target: { in: ["DOCUMENT_CHUNK_BUILD", "ASSET_SOURCE_UPLOAD"] } }] } }), prisma.documentChunk.groupBy({ by: ["vectorStatus"], where: { documentId, version: doc.parsedVersion ?? -1 }, _count: true })]);
  if (doc.parseStatus === "FAILED" || doc.assetJob?.status === "FAILED" || failed || counts.some(v => v.vectorStatus === "FAILED")) return "FAILED";
  if (doc.parsedVersion !== null && doc.chunkedVersion === doc.parsedVersion && counts.length && counts.every(v => v.vectorStatus === "SYNCED")) return "SYNCED";
  return doc.parseStatus === "NOT_REQUESTED" && !doc.assetJob ? "NOT_SYNCED" : "SYNCING";
}
export async function listDeliverables(projectId: string, taskId?: string, page = 1) {
  const rows = await prisma.deliverable.findMany({ where: { projectId, ...(taskId ? { taskId } : {}) }, include: { document: { select: evidenceSelect }, createdBy: { select: { name: true } }, reviewedBy: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 30, skip: (page - 1) * 30 });
  return Promise.all(rows.map(async row => ({ ...row, indexStatus: await assetIndexStatus(row.documentId), downloadUrl: `/api/documents/${row.documentId}/download` })));
}
export async function createDeliverable(projectId: string, input: z.infer<typeof deliverableCreateSchema>, actor: Actor, previousId?: string) {
  return prisma.$transaction(async tx => {
    await lockAssetActor(tx, projectId, actor, ["PM"]);
    const previous = previousId ? await tx.deliverable.findFirst({ where: { id: previousId, projectId } }) : null;
    if (previousId && !previous) throw new AssetError("交付物不存在", 404);
    const priorDoc = await tx.deliverable.findUnique({ where: { documentId: input.documentId } });
    if (priorDoc) {
      if (priorDoc.projectId === projectId && priorDoc.name === input.name && priorDoc.taskId === (input.taskId ?? null) && (previous ? priorDoc.seriesId === previous.seriesId && priorDoc.version > previous.version : priorDoc.version === 1)) return priorDoc;
      throw new AssetError("该文件已绑定交付版本，请上传独立新文件", 409);
    }
    const doc = await tx.document.findFirst({ where: { id: input.documentId, projectId, storageStatus: "AVAILABLE", mediaType: "application/pdf" } });
    if (!doc?.sha256 || !doc.fileSize) throw new AssetError("请先完成同项目 PDF 文件上传", 400);
    if (await tx.documentChunk.count({ where: { documentId: doc.id, leaseUntil: { gt: new Date() } } })) throw new AssetError("文件正在索引，请稍后绑定交付物", 409);
    if (input.taskId && !await tx.task.findFirst({ where: { id: input.taskId, projectId } })) throw new AssetError("任务不属于当前项目", 400);
    if (previous && previous.taskId !== (input.taskId ?? null)) throw new AssetError("版本不可改变任务关联", 400);
    const latest = previous ? await tx.deliverable.findFirst({ where: { projectId, seriesId: previous.seriesId }, orderBy: { version: "desc" } }) : null;
    const id = randomUUID();
    const row = await tx.deliverable.create({ data: { ...input, id, projectId, createdById: actor.actorId, seriesId: previous?.seriesId ?? id, version: latest ? latest.version + 1 : 1 } });
    await tx.document.update({ where: { id: doc.id }, data: { documentType: "DELIVERABLE", visibleRoles: [...readers] } });
    await recordAudit(tx, { ...actor, projectId, action: "DELIVERABLE_CREATED", entityType: "Deliverable", entityId: row.id, after: { name: row.name, taskId: row.taskId, documentId: doc.id, sha256: doc.sha256, version: row.version, seriesId: row.seriesId } });
    return row;
  });
}
export async function queueAssetParse(tx: Prisma.TransactionClient, documentId: string, actor: Actor, projectId: string) {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
  if (doc.parsedVersion !== null && doc.parseStatus === "SUCCEEDED") {
    await tx.documentChunk.updateMany({ where: { documentId, version: doc.parsedVersion, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { vectorStatus: "PENDING", attempts: 0, nextRunAt: new Date(), leaseToken: null, leaseUntil: null } }); return;
  }
  if (["RUNNING", "QUEUED"].includes(doc.parseStatus)) return;
  const version = doc.parseVersion + 1;
  const job = await tx.documentParseJob.create({ data: { documentId, version, requestedById: actor.actorId, requestKey: randomUUID(), modelVersion: mineruModel(), sourceSha256: doc.sha256!, sourceFilename: doc.filename, sourceSize: doc.fileSize!, deadlineAt: new Date(Date.now() + 30 * 60000), ip: actor.ip, userAgent: actor.userAgent } });
  await tx.document.update({ where: { id: documentId }, data: { parseVersion: version, parseStatus: "QUEUED" } });
  await recordAudit(tx, { ...actor, projectId, action: "DOCUMENT_PARSE_REQUESTED", entityType: "DocumentParseJob", entityId: job.id, after: { documentId, version, cloudProcessingConfirmed: true, source: "APPROVED_DELIVERABLE" } });
}
export async function mutateDeliverable(id: string, action: "edit" | "submit" | "review", input: { rowVersion: number; name?: string; decision?: "APPROVED" | "REJECTED"; reviewComment?: string }, actor: Actor) {
  const scope = await prisma.deliverable.findUnique({ where: { id }, select: { projectId: true } }); if (!scope) throw new AssetError("交付物不存在", 404);
  return prisma.$transaction(async tx => {
    await lockAssetActor(tx, scope.projectId, actor, action === "review" ? ["QA", "ADMIN"] : ["PM"]);
    const row = await tx.deliverable.findUniqueOrThrow({ where: { id }, include: { document: true } });
    if (action === "review" && (row.createdById === actor.actorId || row.submittedById === actor.actorId)) throw new AssetError("不能审批自己提交的交付物", 403);
    if (row.rowVersion !== input.rowVersion || row.status !== (action === "review" ? "PENDING_REVIEW" : "DRAFT")) throw new AssetError("交付版本已变化或已冻结，请刷新", 409);
    if (row.document.storageStatus !== "AVAILABLE") throw new AssetError("文件尚未上传成功", 400);
    const status = action === "submit" ? "PENDING_REVIEW" : action === "review" ? input.decision! : "DRAFT";
    const updated = await tx.deliverable.update({ where: { id }, data: { status, rowVersion: { increment: 1 }, ...(action === "edit" ? { name: input.name } : {}), ...(action === "submit" ? { submittedAt: new Date(), submittedById: actor.actorId } : {}), ...(action === "review" ? { reviewedById: actor.actorId, reviewedAt: new Date(), reviewComment: input.reviewComment } : {}) } });
    if (status === "APPROVED") await queueAssetParse(tx, row.documentId, actor, row.projectId);
    await recordAudit(tx, { ...actor, projectId: row.projectId, action: action === "edit" ? "DELIVERABLE_UPDATED" : action === "submit" ? "DELIVERABLE_SUBMITTED" : "DELIVERABLE_REVIEWED", entityType: "Deliverable", entityId: id, before: { status: row.status, name: row.name, rowVersion: row.rowVersion }, after: { status, name: updated.name, rowVersion: updated.rowVersion, version: row.version, documentId: row.documentId, sha256: row.document.sha256, reviewComment: updated.reviewComment, reviewerId: updated.reviewedById, cloudProcessingConfirmed: action === "submit" || status === "APPROVED" } });
    return updated;
  });
}
export async function createMeeting(projectId: string, input: z.infer<typeof meetingSchema>, actor: Actor) {
  return prisma.$transaction(async tx => {
    await lockAssetActor(tx, projectId, actor, ["PM"]);
    const old = await tx.meetingRecord.findUnique({ where: { projectId_requestKey: { projectId, requestKey: input.requestKey } } });
    if (old) {
      if (old.createdById !== actor.actorId || old.title !== input.title || old.content !== input.content || old.meetingDate.toISOString() !== input.meetingDate || JSON.stringify(old.actionItems) !== JSON.stringify(input.actionItems) || JSON.stringify(old.visibleRoles) !== JSON.stringify(input.visibleRoles)) throw new AssetError("请求标识已用于其他纪要", 409);
      return old;
    }
    if (!input.visibleRoles.includes("PM")) throw new AssetError("纪要必须对创建角色 PM 可见", 400);
    for (const item of input.actionItems) if (item.taskId && !await tx.task.findFirst({ where: { id: item.taskId, projectId } })) throw new AssetError("行动项关联任务不属于此项目", 400);
    const row = await tx.meetingRecord.create({ data: { ...input, meetingDate: new Date(input.meetingDate), projectId, createdById: actor.actorId } });
    await recordAudit(tx, { ...actor, projectId, action: "MEETING_CREATED", entityType: "MeetingRecord", entityId: row.id, after: { meetingDate: row.meetingDate.toISOString(), contentSha256: createHash("sha256").update(JSON.stringify({ title: row.title, content: row.content, actionItems: row.actionItems })).digest("hex"), actionItemCount: input.actionItems.length, visibleRoles: row.visibleRoles } }); return row;
  });
}
export async function syncMeeting(id: string, actor: Actor) {
  const scope = await prisma.meetingRecord.findUnique({ where: { id } }); if (!scope) throw new AssetError("会议纪要不存在", 404);
  return prisma.$transaction(async tx => {
    const user = await lockAssetActor(tx, scope.projectId, actor, ["PM", "ADMIN"]);
    const row = await tx.meetingRecord.findUniqueOrThrow({ where: { id } });
    if (!canReadRoles(row.visibleRoles, user.role)) throw new AssetError("无权查看此纪要", 403);
    if (row.documentId) {
      await tx.assetSourceJob.updateMany({ where: { documentId: row.documentId, status: "FAILED", OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { status: "QUEUED", attempts: 0, nextRunAt: new Date(), leaseToken: null, leaseUntil: null } });
      await tx.documentChunk.updateMany({ where: { documentId: row.documentId, vectorStatus: "FAILED", OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { vectorStatus: "PENDING", attempts: 0, nextRunAt: new Date() } });
      await tx.syncFailure.deleteMany({ where: { entityId: row.documentId, target: { in: ["DOCUMENT_CHUNK_BUILD", "ASSET_SOURCE_UPLOAD"] } } });
    } else {
      const docId = randomUUID(); const markdown = `# ${row.title}\n\n${row.meetingDate.toISOString()}\n\n${row.content}\n\n${JSON.stringify(row.actionItems)}`; const bytes = Buffer.from(markdown); const sha256 = createHash("sha256").update(bytes).digest("hex");
      await tx.document.create({ data: { id: docId, projectId: row.projectId, filename: `${row.title}.md`, minioKey: `projects/${row.projectId}/meetings/${docId}.md`, mediaType: "text/markdown", documentType: "MEETING", visibleRoles: row.visibleRoles!, parsedText: markdown, sha256, fileSize: bytes.length, uploadedById: actor.actorId, storageStatus: "UPLOADING", parseStatus: "SUCCEEDED", parseVersion: 1, parsedVersion: 1, parsedAt: new Date() } });
      await tx.documentParseJob.create({ data: { documentId: docId, version: 1, requestKey: randomUUID(), requestedById: actor.actorId, modelVersion: "meeting-text-v1", sourceSha256: sha256, sourceFilename: `${row.title}.md`, sourceSize: bytes.length, deadlineAt: new Date(), status: "SUCCEEDED", markdown, blocks: [], completedAt: new Date() } });
      await tx.assetSourceJob.create({ data: { documentId: docId } });
      await tx.meetingRecord.update({ where: { id }, data: { documentId: docId } });
    }
    await recordAudit(tx, { ...actor, projectId: row.projectId, action: "ASSET_INDEX_REQUESTED", entityType: "MeetingRecord", entityId: id, after: { source: "MEETING", cloudProcessingConfirmed: true, visibleRoles: row.visibleRoles } }); return { queued: true };
  });
}
