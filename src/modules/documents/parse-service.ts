import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { findDocument, lockDocumentActor } from "./repositories";
import * as repository from "./parse-repositories";
import { DocumentError } from "./validation";
import { documentParser } from "./local-parser";
import { canReadDocument } from "./access";

export const parseRequestSchema = z.object({ requestKey: z.uuid(), expectedVersion: z.number().int().min(0), cloudProcessingConfirmed: z.boolean().optional() }).strict();
export async function requestDocumentParse(documentId: string, input: z.infer<typeof parseRequestSchema>, actor: { actorId: string } & AuditRequestMetadata, retry = false) {
  const scope = await findDocument(documentId); if (!scope) throw new DocumentError("文档不存在", 404);
  return prisma.$transaction(async (tx) => {
    await lockDocumentActor(tx, actor.actorId, true, scope.projectId);
    await repository.lockParseDocument(tx, documentId);
    const document = await repository.findParseDocument(tx, documentId);
    if (!document) throw new DocumentError("文档不存在", 404);
    const current = await tx.user.findUniqueOrThrow({ where: { id: actor.actorId }, select: { role: true } });
    if (!canReadDocument(document, current.role)) throw new DocumentError("无权处理此会议附件", 403);
    if (document.meetingAttachment?.status === "DRAFT") throw new DocumentError("会议定稿后才可解析附件", 409);
    const prior = await repository.findParseRequest(tx, documentId, input.requestKey);
    if (prior) return prior;
    if (document.storageStatus !== "AVAILABLE") throw new DocumentError("文档存储尚未就绪", 409);
    if (!document.sha256 || !document.fileSize) throw new DocumentError("文档元数据尚未核验", 409);
    if (document.parseVersion !== input.expectedVersion || ["QUEUED", "RUNNING"].includes(document.parseStatus)) throw new DocumentError("解析状态已变化，请刷新", 409);
    if (retry && document.parseStatus !== "FAILED") throw new DocumentError("仅失败解析可重试", 409);
    const version = document.parseVersion + 1;
    const parser = documentParser(document.filename);
    if (parser.cloud && input.cloudProcessingConfirmed !== true) throw new DocumentError("请确认将合成 PDF 发送到 MinerU 云端处理", 400);
    const deliverable = await tx.deliverable.findUnique({ where: { documentId }, select: { status: true } });
    if (deliverable && deliverable.status !== "APPROVED") throw new DocumentError("交付物须审批通过后才允许解析与索引", 409);
    const job = await repository.insertParseJob(tx, { documentId, version, requestedById: actor.actorId, requestKey: input.requestKey, modelVersion: parser.modelVersion, provider: parser.provider, phase: parser.phase, sourceSha256: document.sha256, sourceFilename: document.filename, sourceSize: document.fileSize, deadlineAt: new Date(Date.now() + 30 * 60000), ip: actor.ip, userAgent: actor.userAgent });
    await repository.updateParseDocument(tx, { where: { id: documentId, parseVersion: input.expectedVersion }, data: { parseVersion: version, parseStatus: "QUEUED" } });
    await recordAudit(tx, { ...actor, projectId: document.projectId, action: "DOCUMENT_PARSE_REQUESTED", entityType: "DocumentParseJob", entityId: job.id, before: { parseVersion: document.parseVersion, parseStatus: document.parseStatus }, after: { documentId, version, provider: parser.provider, modelVersion: parser.modelVersion, retry, cloudProcessingConfirmed: parser.cloud, sourceSha256: document.sha256 } });
    return { id: job.id, version, status: job.status };
  });
}
