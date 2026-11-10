import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { recordAudit } from "@/modules/audit/service";
import { lockProjectForWrite, lockUsers } from "@/modules/auth/transaction-locks";
import { documentEmbeddingModel, embedDocumentText } from "@/modules/ai/embeddings";
import { upsertDocumentVector } from "@/modules/vector/documents";
import { chunkParsedDocument, CHUNKER_VERSION } from "./chunking";
import * as repository from "./rag-repositories";

export async function buildDocumentChunksTick() {
  const [candidate] = await repository.buildCandidate(); if (!candidate) return false;
  const job = await repository.parseForChunks(candidate.id, candidate.parsedVersion);
  if (!job || job.status !== "SUCCEEDED" || job.markdown === null) throw new Error("Successful parse result is missing");
  let chunks: ReturnType<typeof chunkParsedDocument>;
  try { chunks = chunkParsedDocument(job.markdown, job.blocks); }
  catch {
    // Quarantine oversized normalized output so one document cannot starve the queue.
    await prisma.$transaction(async (tx) => {
      await lockProjectForWrite(tx, candidate.projectId, true); await lockUsers(tx, [SYSTEM_USER_ID]);
      await repository.lockRagDocument(tx, candidate.id);
      const document = await repository.loadRagDocumentTx(tx, candidate.id);
      if (document.parsedVersion !== candidate.parsedVersion || await repository.buildFailureTx(tx, document.id, candidate.parsedVersion)) return;
      await repository.insertSyncFailure(tx, { projectId: document.projectId, entityType: "Document", entityId: document.id, target: "DOCUMENT_CHUNK_BUILD", payload: { version: candidate.parsedVersion }, error: "DOCUMENT_CHUNK_LIMIT", retryCount: 1 });
      await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: document.projectId, action: "DOCUMENT_CHUNK_FAILED", entityType: "Document", entityId: document.id, after: { version: candidate.parsedVersion, errorCode: "DOCUMENT_CHUNK_LIMIT" }, userAgent: "document-rag-worker" });
    });
    return true;
  }
  const model = documentEmbeddingModel();
  await prisma.$transaction(async (tx) => {
    await lockProjectForWrite(tx, candidate.projectId, true); await lockUsers(tx, [SYSTEM_USER_ID]);
    await repository.lockRagDocument(tx, candidate.id);
    const document = await repository.loadRagDocumentTx(tx, candidate.id);
    if (document.parsedVersion !== candidate.parsedVersion || document.chunkedVersion === candidate.parsedVersion || document.storageStatus !== "AVAILABLE") return;
    const asset = await tx.deliverable.findUnique({ where: { documentId: document.id }, select: { status: true } });
    if (asset && asset.status !== "APPROVED") return;
    for (let offset = 0; offset < chunks.length; offset += 200) {
      await repository.insertChunks(tx, chunks.slice(offset, offset + 200).map((chunk) => ({ ...chunk, id: randomUUID(), documentId: document.id, projectId: document.projectId, parseJobId: job.id, version: candidate.parsedVersion, embeddingModel: model })));
    }
    await repository.markChunked(tx, document.id, candidate.parsedVersion);
    await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: document.projectId, action: "DOCUMENT_CHUNKED", entityType: "Document", entityId: document.id, after: { version: candidate.parsedVersion, parseJobId: job.id, chunkCount: chunks.length, chunker: CHUNKER_VERSION, embeddingModel: model }, userAgent: "document-rag-worker" });
  }, { timeout: 30000 });
  return true;
}

export type DocumentIndexAdapters = { embed: typeof embedDocumentText; upsert: typeof upsertDocumentVector };
export async function syncDocumentVectorTick(adapters: DocumentIndexAdapters = { embed: embedDocumentText, upsert: upsertDocumentVector }) {
  const chunk = await prisma.$transaction(async (tx) => {
    const now = new Date(); const candidate = await repository.vectorCandidate(tx, now); if (!candidate) return null;
    await lockProjectForWrite(tx, candidate.projectId, true);
    const token = randomUUID();
    const updated = await repository.updateChunk(tx, { where: { id: candidate.id, vectorStatus: { in: ["PENDING", "FAILED"] }, attempts: { lt: 5 }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { leaseToken: token, leaseUntil: new Date(now.getTime() + 60000) } });
    return updated.count === 1 ? { ...candidate, leaseToken: token } : null;
  }, { isolationLevel: "ReadCommitted" });
  if (!chunk) return false;
  const owned = { id: chunk.id, leaseToken: chunk.leaseToken, leaseUntil: { gt: new Date() } };
  let timer: ReturnType<typeof setTimeout> | undefined; let expired = false;
  try {
    await Promise.race([
      (async () => {
        const metadata = await prisma.document.findUniqueOrThrow({ where: { id: chunk.documentId }, select: { documentType: true, visibleRoles: true, deliverable: { select: { id: true, status: true } } } });
        if (metadata.deliverable && metadata.deliverable.status !== "APPROVED") throw new Error("ASSET_NOT_APPROVED");
        const embedding = await adapters.embed(chunk.text, chunk.embeddingModel); if (expired) return;
        await adapters.upsert({ id: chunk.id, docId: chunk.documentId, projectId: chunk.projectId, embedding, createdAt: chunk.createdAt, documentType: metadata.documentType, visibleRoles: metadata.visibleRoles as string[], deliverableId: metadata.deliverable?.id ?? "" });
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("DOCUMENT_INDEX_TIMEOUT")); }, 40000); }),
    ]);
    await prisma.$transaction(async (tx) => {
      await lockProjectForWrite(tx, chunk.projectId, true); await lockUsers(tx, [SYSTEM_USER_ID]);
      const updated = await repository.updateChunk(tx, { where: { ...owned, leaseUntil: { gt: new Date() } }, data: { vectorStatus: "SYNCED", errorCode: null, leaseUntil: null, leaseToken: null } });
      if (updated.count !== 1) return;
      await repository.removeSyncFailure(tx, chunk.id);
      await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: chunk.projectId, action: "DOCUMENT_VECTOR_SYNCED", entityType: "DocumentChunk", entityId: chunk.id, after: { documentId: chunk.documentId, version: chunk.version, embeddingModel: chunk.embeddingModel, textSha256: chunk.textSha256 }, userAgent: "document-rag-worker" });
    });
  } catch {
    await prisma.$transaction(async (tx) => {
      await lockProjectForWrite(tx, chunk.projectId, true); await lockUsers(tx, [SYSTEM_USER_ID]);
      const attempts = chunk.attempts + 1;
      const updated = await repository.updateChunk(tx, { where: { ...owned, leaseUntil: { gt: new Date() } }, data: { vectorStatus: "FAILED", attempts, errorCode: "DOCUMENT_VECTOR_SYNC_FAILED", nextRunAt: new Date(Date.now() + Math.min(300000, 10000 * 2 ** attempts)), leaseToken: null, leaseUntil: null } });
      if (updated.count !== 1) return;
      const failure = await repository.findSyncFailure(tx, chunk.id);
      if (failure) await repository.updateSyncFailure(tx, failure.id, attempts);
      else await repository.insertSyncFailure(tx, { projectId: chunk.projectId, entityType: "DocumentChunk", entityId: chunk.id, target: "MILVUS_DOCUMENT_CHUNK", payload: { documentId: chunk.documentId, version: chunk.version, embeddingModel: chunk.embeddingModel }, error: "DOCUMENT_VECTOR_SYNC_FAILED", retryCount: attempts });
      await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: chunk.projectId, action: "DOCUMENT_VECTOR_FAILED", entityType: "DocumentChunk", entityId: chunk.id, after: { documentId: chunk.documentId, version: chunk.version, attempts, errorCode: "DOCUMENT_VECTOR_SYNC_FAILED" }, userAgent: "document-rag-worker" });
    });
  } finally { if (timer) clearTimeout(timer); }
  return true;
}
