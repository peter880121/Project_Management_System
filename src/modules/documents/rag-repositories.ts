import { FROZEN_PROJECT_STATUSES } from "@/modules/projects/freeze";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { documentEmbeddingModel } from "@/modules/ai/embeddings";

export type SearchScope = { projectId: string; documentId?: string; version?: number; role?: string };
export type AssistantSearchScope = { projectIds: string[]; role: string };
export type ChunkEvidence = { id: string; documentId: string; version: number; ordinal: number; text: string; textSha256: string; page: number | null; blockIndex: number | null; startOffset: number; endOffset: number; filename: string; parseJobId: string };
type RawEvidence = Omit<ChunkEvidence, "version" | "ordinal" | "page" | "blockIndex" | "startOffset" | "endOffset"> & { version: number | bigint; ordinal: number | bigint; page: number | bigint | null; blockIndex: number | bigint | null; startOffset: number | bigint; endOffset: number | bigint };
function normalizeEvidence(row: RawEvidence): ChunkEvidence {
  return { ...row, version: Number(row.version), ordinal: Number(row.ordinal), page: row.page === null ? null : Number(row.page), blockIndex: row.blockIndex === null ? null : Number(row.blockIndex), startOffset: Number(row.startOffset), endOffset: Number(row.endOffset) };
}
export const findRagProject = (id: string) => prisma.project.findUnique({ where: { id }, select: { id: true } });
const columns = Prisma.sql`c.id, c.documentId, c.version, c.ordinal, c.text, c.textSha256, c.page, c.blockIndex, c.startOffset, c.endOffset, c.parseJobId, d.filename`;
function scopeWhere(scope: SearchScope | AssistantSearchScope) {
  const projectScope = "projectIds" in scope ? scope.projectIds.length ? Prisma.sql`d.projectId IN (${Prisma.join(scope.projectIds)}) AND c.projectId=d.projectId` : Prisma.sql`FALSE` : Prisma.sql`d.projectId = ${scope.projectId} AND c.projectId = ${scope.projectId}`;
  return Prisma.sql`${projectScope} AND d.storageStatus = 'AVAILABLE'
    AND ${scope.role === "ADMIN" ? Prisma.sql`TRUE` : Prisma.sql`JSON_CONTAINS(d.visibleRoles, JSON_QUOTE(${scope.role ?? "MEMBER"}))`}
    AND NOT EXISTS (SELECT 1 FROM Deliverable a WHERE a.documentId = d.id AND a.status <> 'APPROVED')
    AND (d.meetingAttachmentId IS NULL OR EXISTS (SELECT 1 FROM MeetingRecord m WHERE m.id=d.meetingAttachmentId AND m.projectId=d.projectId AND m.status='FINALIZED' AND (${scope.role === "ADMIN" ? Prisma.sql`TRUE` : Prisma.sql`JSON_CONTAINS(m.visibleRoles,JSON_QUOTE(${scope.role ?? "MEMBER"}))`})))
    AND ${"documentId" in scope && scope.documentId ? Prisma.sql`d.id = ${scope.documentId}` : Prisma.sql`TRUE`}
    AND ${"version" in scope && scope.version !== undefined ? Prisma.sql`c.version = ${scope.version}` : Prisma.sql`c.version = d.parsedVersion`}`;
}
export type AssistantEvidence = ChunkEvidence & { projectId: string; projectName: string };
type AssistantRaw = RawEvidence & { projectId: string; projectName: string };
export async function assistantEvidence(scope: AssistantSearchScope, query: string, ids?: string[]): Promise<AssistantEvidence[]> {
  if (!scope.projectIds.length || ids && !ids.length) return [];
  const terms = queryTerms(query); if (!ids && !terms.length) return [];
  const scores = terms.map(term => Prisma.sql`(LOCATE(${term}, LOWER(c.text)) > 0)`);
  const rows = await prisma.$queryRaw<AssistantRaw[]>(Prisma.sql`SELECT ${columns}, d.projectId, p.name AS projectName FROM DocumentChunk c JOIN Document d ON d.id=c.documentId JOIN Project p ON p.id=d.projectId
    WHERE ${scopeWhere(scope)} AND ${ids ? Prisma.sql`c.embeddingModel=${documentEmbeddingModel()} AND c.vectorStatus='SYNCED' AND c.id IN (${Prisma.join(ids)})` : Prisma.sql`(${Prisma.join(scores, " OR ")})`}
    ORDER BY ${ids ? Prisma.sql`c.id` : Prisma.sql`(${Prisma.join(scores, " + ")}) DESC, c.id`} LIMIT 64`);
  const normalized = rows.map(row => ({ ...normalizeEvidence(row), projectId: row.projectId, projectName: row.projectName }));
  return ids ? ids.flatMap(id => normalized.filter(row => row.id === id)) : normalized;
}
export async function loadEvidenceByIds(scope: SearchScope, ids: string[]) {
  if (!ids.length) return [];
  const rows = await prisma.$queryRaw<RawEvidence[]>(Prisma.sql`SELECT ${columns} FROM DocumentChunk c JOIN Document d ON d.id = c.documentId WHERE ${scopeWhere(scope)} AND c.embeddingModel = ${documentEmbeddingModel()} AND c.vectorStatus = 'SYNCED' AND c.id IN (${Prisma.join(ids)})`);
  const byId = new Map(rows.map((row) => [row.id, normalizeEvidence(row)]));
  return ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
}
export function queryTerms(query: string) {
  const words = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Chinese queries often contain no spaces. Whole phrases plus bigrams keep fallback usable.
  const terms = words.flatMap((word) => /[\u3400-\u9fff]/.test(word) && word.length > 2 ? [word, ...Array.from({ length: Math.min(word.length - 1, 6) }, (_, index) => word.slice(index, index + 2))] : [word]);
  return [...new Set(terms)].slice(0, 12);
}
export async function keywordEvidence(scope: SearchScope, query: string, limit: number) {
  const terms = queryTerms(query); if (!terms.length) return [];
  const scores = terms.map((term) => Prisma.sql`(LOCATE(${term}, LOWER(c.text)) > 0)`);
  const rows = await prisma.$queryRaw<RawEvidence[]>(Prisma.sql`SELECT ${columns} FROM DocumentChunk c JOIN Document d ON d.id = c.documentId
    WHERE ${scopeWhere(scope)} AND (${Prisma.join(scores, " OR ")})
    ORDER BY (${Prisma.join(scores, " + ")}) DESC, c.documentId, c.ordinal LIMIT ${limit}`);
  return rows.map(normalizeEvidence);
}
export const chunkSource = (id: string) => prisma.documentChunk.findUnique({ where: { id }, select: { id: true, documentId: true, projectId: true, version: true, ordinal: true, text: true, textSha256: true, page: true, blockIndex: true, startOffset: true, endOffset: true, parseJobId: true, document: { select: { projectId: true, storageStatus: true, filename: true, parsedVersion: true, visibleRoles: true, meetingAttachment: { select: { id: true, projectId: true, visibleRoles: true, status: true } }, deliverable: { select: { status: true } } } } } });
export const ragStatus = (documentId: string, version: number) => prisma.documentChunk.groupBy({ by: ["vectorStatus"], where: { documentId, version }, _count: true });
export const findRagDocument = (id: string) => prisma.document.findUnique({ where: { id }, select: { id: true, projectId: true, parsedVersion: true, chunkedVersion: true } });
export const buildFailure = (id: string, version: number) => prisma.syncFailure.findFirst({ where: { entityId: id, target: "DOCUMENT_CHUNK_BUILD", payload: { path: "$.version", equals: version } }, select: { id: true } });
export const buildFailureTx = (tx: Prisma.TransactionClient, id: string, version: number) => tx.syncFailure.findFirst({ where: { entityId: id, target: "DOCUMENT_CHUNK_BUILD", payload: { path: "$.version", equals: version } }, select: { id: true } });
export const clearBuildFailure = (tx: Prisma.TransactionClient, id: string, version: number) => tx.syncFailure.deleteMany({ where: { entityId: id, target: "DOCUMENT_CHUNK_BUILD", payload: { path: "$.version", equals: version } } });
export const lockRagDocument = (tx: Prisma.TransactionClient, id: string) => tx.$queryRaw`SELECT id FROM Document WHERE id = ${id} FOR UPDATE`;
export async function buildCandidate() {
  const rows = await prisma.$queryRaw<{ id: string; projectId: string; parsedVersion: number | bigint }[]>`SELECT d.id, d.projectId, d.parsedVersion FROM Document d WHERE d.storageStatus = 'AVAILABLE' AND (d.meetingAttachmentId IS NULL OR EXISTS (SELECT 1 FROM MeetingRecord m WHERE m.id=d.meetingAttachmentId AND m.projectId=d.projectId AND m.status='FINALIZED')) AND NOT EXISTS (SELECT 1 FROM Deliverable a WHERE a.documentId=d.id AND a.status<>'APPROVED') AND EXISTS (SELECT 1 FROM Project p WHERE p.id = d.projectId AND p.status NOT IN (${Prisma.join([...FROZEN_PROJECT_STATUSES])})) AND d.parsedVersion IS NOT NULL AND (d.chunkedVersion IS NULL OR d.chunkedVersion <> d.parsedVersion) AND NOT EXISTS (SELECT 1 FROM SyncFailure f WHERE f.entityId = d.id AND f.target = 'DOCUMENT_CHUNK_BUILD' AND JSON_EXTRACT(f.payload, '$.version') = d.parsedVersion) ORDER BY d.parsedAt, d.id LIMIT 1`;
  return rows.map((row) => ({ ...row, parsedVersion: Number(row.parsedVersion) }));
}
export const parseForChunks = (documentId: string, version: number) => prisma.documentParseJob.findUnique({ where: { documentId_version: { documentId, version } }, select: { id: true, status: true, markdown: true, blocks: true } });
export const loadRagDocumentTx = (tx: Prisma.TransactionClient, id: string) => tx.document.findUniqueOrThrow({ where: { id } });
export const insertChunks = (tx: Prisma.TransactionClient, data: Prisma.DocumentChunkCreateManyInput[]) => tx.documentChunk.createMany({ data });
export const markChunked = (tx: Prisma.TransactionClient, id: string, version: number) => tx.document.update({ where: { id }, data: { chunkedVersion: version } });
export const vectorCandidate = (tx: Prisma.TransactionClient, now: Date) => tx.documentChunk.findFirst({ where: { document: { project: { status: { notIn: [...FROZEN_PROJECT_STATUSES] } }, OR: [{ deliverable: { is: null } }, { deliverable: { is: { status: "APPROVED" } } }], AND: [{ OR: [{ meetingAttachment: { is: null } }, { meetingAttachment: { is: { status: "FINALIZED" } } }] }] }, vectorStatus: { in: ["PENDING", "FAILED"] }, attempts: { lt: 5 }, nextRunAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: [{ nextRunAt: "asc" }, { id: "asc" }] });
export const updateChunk = (tx: Prisma.TransactionClient, args: Prisma.DocumentChunkUpdateManyArgs) => tx.documentChunk.updateMany(args);
export const findSyncFailure = (tx: Prisma.TransactionClient, id: string) => tx.syncFailure.findFirst({ where: { target: "MILVUS_DOCUMENT_CHUNK", entityId: id } });
export const insertSyncFailure = (tx: Prisma.TransactionClient, data: Prisma.SyncFailureUncheckedCreateInput) => tx.syncFailure.create({ data });
export const updateSyncFailure = (tx: Prisma.TransactionClient, id: string, retryCount: number) => tx.syncFailure.update({ where: { id }, data: { retryCount, error: "DOCUMENT_VECTOR_SYNC_FAILED" } });
export const removeSyncFailure = (tx: Prisma.TransactionClient, id: string) => tx.syncFailure.deleteMany({ where: { target: "MILVUS_DOCUMENT_CHUNK", entityId: id } });
export const retryChunks = (tx: Prisma.TransactionClient, documentId: string, version: number) => tx.documentChunk.updateMany({ where: { documentId, version, vectorStatus: "FAILED", OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { vectorStatus: "PENDING", attempts: 0, nextRunAt: new Date(), errorCode: null, leaseToken: null, leaseUntil: null } });
