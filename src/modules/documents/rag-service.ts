import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { embedDocumentText } from "@/modules/ai/embeddings";
import { searchDocumentVectors } from "@/modules/vector/documents";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { lockDocumentActor } from "./repositories";
import { DocumentError } from "./validation";
import * as repository from "./rag-repositories";

export const documentSearchSchema = z.object({ query: z.string().trim().min(1).max(2000).refine((value) => /[\p{L}\p{N}]/u.test(value), "请输入文字或数字"), limit: z.number().int().min(1).max(12).default(8), documentId: z.uuid().optional(), version: z.number().int().positive().optional() }).strict().refine((value) => value.version === undefined || value.documentId !== undefined, "指定版本时需指定文档");
export type RetrievalAdapters = {
  embed: (query: string) => Promise<number[]>;
  search: (projectId: string, embedding: number[], documentId?: string) => Promise<string[]>;
  load: typeof repository.loadEvidenceByIds;
  keyword: typeof repository.keywordEvidence;
  timeoutMs?: number;
};
const production: RetrievalAdapters = { embed: embedDocumentText, search: searchDocumentVectors, load: repository.loadEvidenceByIds, keyword: repository.keywordEvidence };

/** No embedding/upsert/backfill is performed after falling back. The worker owns indexing. */
export async function retrieveDocumentEvidence(scope: repository.SearchScope, query: string, limit = 8, adapters = production) {
  const started = Date.now(); let timer: ReturnType<typeof setTimeout> | undefined; let expired = false;
  let hits: repository.ChunkEvidence[] = []; let reason: string | null = null;
  try {
    hits = await Promise.race([
      (async () => {
        const embedding = await adapters.embed(query); if (expired) return [];
        const ids = await adapters.search(scope.projectId, embedding, scope.documentId); if (expired) return [];
        return adapters.load(scope, ids);
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("RETRIEVAL_TIMEOUT")); }, adapters.timeoutMs ?? 1500); }),
    ]);
    if (!hits.length) reason = "VECTOR_NO_CURRENT_HITS";
  } catch { reason = expired ? "VECTOR_TIMEOUT" : "VECTOR_UNAVAILABLE"; }
  finally { if (timer) clearTimeout(timer); }
  if (reason) hits = await adapters.keyword(scope, query, limit);
  hits = hits.slice(0, limit);
  return { hits, hitIds: hits.map((hit) => hit.id), degraded: reason !== null, reason, mode: reason ? "keyword" as const : "vector" as const, durationMs: Date.now() - started };
}
export async function searchProjectDocuments(projectId: string, input: z.infer<typeof documentSearchSchema>, actor: { actorId: string } & AuditRequestMetadata) {
  if (!await repository.findRagProject(projectId)) throw new DocumentError("项目不存在", 404);
  if (input.documentId) {
    const document = await repository.findRagDocument(input.documentId);
    if (!document || document.projectId !== projectId) throw new DocumentError("项目文档不存在", 404);
  }
  const result = await retrieveDocumentEvidence({ projectId, documentId: input.documentId, version: input.version }, input.query, input.limit);
  // Fail closed if the evidence cannot be audited; do not return unaudited sources.
  await prisma.$transaction(async (tx) => {
    await lockDocumentActor(tx, actor.actorId, false, projectId);
    await recordAudit(tx, { ...actor, projectId, action: "RAG_SEARCH", entityType: "Project", entityId: projectId, after: {
      source: "documents", query: input.query, documentId: input.documentId ?? null, version: input.version ?? null,
      hitIds: result.hitIds, evidence: result.hits.map((hit) => ({ chunkId: hit.id, documentId: hit.documentId, version: hit.version, textSha256: hit.textSha256, page: hit.page })),
      durationMs: result.durationMs, degraded: result.degraded, reason: result.reason, mode: result.mode,
    } });
  });
  return { ...result, hits: result.hits.map((hit) => ({ ...hit, sourceUrl: `/projects/${projectId}/documents/chunks/${hit.id}` })) };
}
export async function getDocumentRagStatus(documentId: string) {
  const document = await repository.findRagDocument(documentId); if (!document) throw new DocumentError("文档不存在", 404);
  const counts = document.parsedVersion === null ? [] : await repository.ragStatus(documentId, document.parsedVersion);
  const failure = document.parsedVersion === null ? null : await repository.buildFailure(documentId, document.parsedVersion);
  return { ...document, chunkingReady: document.parsedVersion !== null && document.parsedVersion === document.chunkedVersion, buildErrorCode: failure ? "DOCUMENT_CHUNK_LIMIT" : null, counts: Object.fromEntries(counts.map((row) => [row.vectorStatus, row._count])) };
}
export async function retryDocumentVectors(documentId: string, version: number, actor: { actorId: string } & AuditRequestMetadata) {
  const scope = await repository.findRagDocument(documentId); if (!scope) throw new DocumentError("?????", 404);
  return prisma.$transaction(async (tx) => {
    await lockDocumentActor(tx, actor.actorId, true, scope.projectId); await repository.lockRagDocument(tx, documentId);
    const document = await repository.loadRagDocumentTx(tx, documentId);
    if (version !== document.parsedVersion) throw new DocumentError("文档版本已变化，请刷新", 409);
    const changed = await repository.retryChunks(tx, documentId, version);
    const build = await repository.clearBuildFailure(tx, documentId, version);
    await recordAudit(tx, { ...actor, projectId: document.projectId, action: "VECTOR_SYNC_RETRIED", entityType: "Document", entityId: documentId, after: { version, queuedChunks: changed.count, queuedBuild: build.count > 0, target: "MILVUS_DOCUMENT_CHUNK" } });
    return { queuedChunks: changed.count, queuedBuild: build.count > 0 };
  });
}
