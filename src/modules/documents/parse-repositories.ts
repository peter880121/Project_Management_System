import { FROZEN_PROJECT_STATUSES } from "@/modules/projects/freeze";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
export const findParseDocument = (tx: Prisma.TransactionClient, id: string) => tx.document.findUnique({ where: { id }, include: { meetingAttachment: { select: { projectId: true, visibleRoles: true, status: true } } } });
export const lockParseDocument = (tx: Prisma.TransactionClient, id: string) => tx.$queryRaw`SELECT id FROM Document WHERE id = ${id} FOR UPDATE`;
export const findParseRequest = (tx: Prisma.TransactionClient, documentId: string, requestKey: string) => tx.documentParseJob.findUnique({ where: { documentId_requestKey: { documentId, requestKey } }, select: { id: true, version: true, status: true } });
export const insertParseJob = (tx: Prisma.TransactionClient, data: Prisma.DocumentParseJobUncheckedCreateInput) => tx.documentParseJob.create({ data });
export const updateParseDocument = (tx: Prisma.TransactionClient, args: Prisma.DocumentUpdateManyArgs) => tx.document.updateMany(args);
export const updateParseJob = (tx: Prisma.TransactionClient, args: Prisma.DocumentParseJobUpdateManyArgs) => tx.documentParseJob.updateMany(args);
export const findParseJob = (tx: Prisma.TransactionClient, id: string) => tx.documentParseJob.findUnique({ where: { id }, include: { document: true } });
export const publicJobSelect = { id: true, documentId: true, version: true, status: true, phase: true, provider: true, modelVersion: true, attempts: true, errorCode: true, createdAt: true, completedAt: true, requestedById: true } satisfies Prisma.DocumentParseJobSelect;
export function listParseJobs(documentId: string) { return prisma.documentParseJob.findMany({ where: { documentId }, select: publicJobSelect, orderBy: { version: "desc" }, take: 20 }); }
export const previewParseJob = (documentId: string, version: number) => prisma.documentParseJob.findUnique({ where: { documentId_version: { documentId, version } }, select: { ...publicJobSelect, markdown: true, blocks: true, resultSha256: true } });
export const findParseCandidate = (tx: Prisma.TransactionClient, now: Date) => tx.documentParseJob.findFirst({ where: { document: { project: { status: { notIn: [...FROZEN_PROJECT_STATUSES] } } }, status: { in: ["QUEUED", "RUNNING"] }, nextRunAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: [{ nextRunAt: "asc" }, { id: "asc" }], select: { id: true, documentId: true, document: { select: { projectId: true } } } });
export const queueParseArtifact = (tx: Prisma.TransactionClient, documentId: string, projectId: string, jobId: string, key: string) => tx.syncFailure.create({ data: { projectId, entityType: "DocumentParseJob", entityId: jobId, target: "MINIO_PARSE_ARTIFACT_CLEANUP", payload: { documentId, minioKey: key }, error: "Unconfirmed parse artifact; preserve while active or referenced" } });
export const removeArtifactWork = (tx: Prisma.TransactionClient, id: string) => tx.syncFailure.deleteMany({ where: { id, target: "MINIO_PARSE_ARTIFACT_CLEANUP" } });
export const artifactWork = () => prisma.syncFailure.findFirst({ where: { project: { status: { notIn: [...FROZEN_PROJECT_STATUSES] } }, target: "MINIO_PARSE_ARTIFACT_CLEANUP", retryCount: { lt: 5 }, createdAt: { lt: new Date(Date.now() - 5 * 60000) } }, orderBy: { createdAt: "asc" } });
export const loadArtifactJob = (id: string) => prisma.documentParseJob.findUnique({ where: { id }, include: { document: true } });
export const failArtifactWork = (tx: Prisma.TransactionClient, id: string) => tx.syncFailure.updateMany({ where: { id }, data: { retryCount: { increment: 1 } } });
