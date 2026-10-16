import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { findDocument, lockDocumentActor } from "./repositories";
import * as repository from "./parse-repositories";
import { DocumentError } from "./validation";
import { mineruModel } from "./mineru";

export const parseRequestSchema = z.object({ requestKey: z.uuid(), expectedVersion: z.number().int().min(0), cloudProcessingConfirmed: z.literal(true) }).strict();
export async function requestDocumentParse(documentId: string, input: z.infer<typeof parseRequestSchema>, actor: { actorId: string } & AuditRequestMetadata, retry = false) {
  const scope = await findDocument(documentId); if (!scope) throw new DocumentError("?????", 404);
  return prisma.$transaction(async (tx) => {
    await lockDocumentActor(tx, actor.actorId, true, scope.projectId);
    await repository.lockParseDocument(tx, documentId);
    const document = await repository.findParseDocument(tx, documentId);
    if (!document) throw new DocumentError("文档不存在", 404);
    const prior = await repository.findParseRequest(tx, documentId, input.requestKey);
    if (prior) return prior;
    if (document.storageStatus !== "AVAILABLE") throw new DocumentError("文档存储尚未就绪", 409);
    if (!document.sha256 || !document.fileSize) throw new DocumentError("文档元数据尚未核验", 409);
    if (document.parseVersion !== input.expectedVersion || ["QUEUED", "RUNNING"].includes(document.parseStatus)) throw new DocumentError("解析状态已变化，请刷新", 409);
    if (retry && document.parseStatus !== "FAILED") throw new DocumentError("仅失败解析可重试", 409);
    const version = document.parseVersion + 1;
    const modelVersion = mineruModel();
    const job = await repository.insertParseJob(tx, { documentId, version, requestedById: actor.actorId, requestKey: input.requestKey, modelVersion, sourceSha256: document.sha256, sourceFilename: document.filename, sourceSize: document.fileSize, deadlineAt: new Date(Date.now() + 30 * 60000), ip: actor.ip, userAgent: actor.userAgent });
    await repository.updateParseDocument(tx, { where: { id: documentId, parseVersion: input.expectedVersion }, data: { parseVersion: version, parseStatus: "QUEUED" } });
    await recordAudit(tx, { ...actor, projectId: document.projectId, action: "DOCUMENT_PARSE_REQUESTED", entityType: "DocumentParseJob", entityId: job.id, before: { parseVersion: document.parseVersion, parseStatus: document.parseStatus }, after: { documentId, version, provider: "mineru-cloud-v4", modelVersion, retry, cloudProcessingConfirmed: true, sourceSha256: document.sha256 } });
    return { id: job.id, version, status: job.status };
  });
}
