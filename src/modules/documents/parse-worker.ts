import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { recordAudit } from "@/modules/audit/service";
import { lockProject, lockUsers } from "@/modules/auth/transaction-locks";
import { documentStorage, parseArtifactStorage, type DocumentStorage } from "./storage";
import { createMineruClient, ParseError, type MineruClient } from "./mineru";
import * as repository from "./parse-repositories";
import { buildDocumentChunksTick, syncDocumentVectorTick } from "./rag-worker";

const LEASE_MS = 180000;
async function claimJob() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const candidate = await repository.findParseCandidate(tx, now); if (!candidate) return null;
        await lockProject(tx, candidate.document.projectId); await lockUsers(tx, [SYSTEM_USER_ID]);
        await repository.lockParseDocument(tx, candidate.documentId);
        const token = randomUUID();
        const changed = await repository.updateParseJob(tx, { where: { id: candidate.id, status: { in: ["QUEUED", "RUNNING"] }, nextRunAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS), status: "RUNNING" } });
        if (changed.count !== 1) return null;
        const job = (await repository.findParseJob(tx, candidate.id))!;
        await repository.updateParseDocument(tx, { where: { id: job.documentId, parseVersion: job.version }, data: { parseStatus: "RUNNING" } });
        await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: job.document.projectId, action: "DOCUMENT_PARSE_STARTED", entityType: "DocumentParseJob", entityId: job.id, after: { documentId: job.documentId, version: job.version, phase: job.phase, requestedById: job.requestedById }, userAgent: "document-parser-worker" });
        return job;
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  return null;
}
type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimJob>>>;
function owned(job: ClaimedJob) { return { id: job.id, status: "RUNNING" as const, leaseToken: job.leaseToken, leaseUntil: { gt: new Date() } }; }
async function checkpoint(job: ClaimedJob, data: Prisma.DocumentParseJobUpdateManyMutationInput) {
  await prisma.$transaction(async (tx) => {
    const updated = await repository.updateParseJob(tx, { where: owned(job), data: { ...data, leaseToken: null, leaseUntil: null, nextRunAt: new Date(Date.now() + 2000) } });
    if (updated.count !== 1) throw new ParseError("PARSE_LEASE_LOST");
  });
}
async function recordFailure(job: ClaimedJob, error: unknown) {
  const safe = error instanceof ParseError ? error : new ParseError("PARSE_INFRASTRUCTURE", true);
  const attempts = job.attempts + 1;
  const terminal = !safe.retryable || attempts >= 3 || job.deadlineAt.getTime() <= Date.now();
  await prisma.$transaction(async (tx) => {
    await lockProject(tx, job.document.projectId); await lockUsers(tx, [SYSTEM_USER_ID]);
    await repository.lockParseDocument(tx, job.documentId);
    const changed = await repository.updateParseJob(tx, { where: owned(job), data: { status: terminal ? "FAILED" : "RUNNING", attempts, errorCode: safe.code, leaseToken: null, leaseUntil: null, nextRunAt: new Date(Date.now() + 5000 * attempts), completedAt: terminal ? new Date() : null } });
    if (changed.count !== 1) return;
    if (terminal) await repository.updateParseDocument(tx, { where: { id: job.documentId, parseVersion: job.version }, data: { parseStatus: "FAILED" } });
    await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: job.document.projectId, action: "DOCUMENT_PARSE_FAILED", entityType: "DocumentParseJob", entityId: job.id, before: { status: "RUNNING" }, after: { status: terminal ? "FAILED" : "RUNNING", errorCode: safe.code, attempts, documentId: job.documentId, version: job.version, requestedById: job.requestedById }, userAgent: "document-parser-worker" });
  });
}
export async function runParseWorkerTick(adapters?: { mineru: MineruClient; storage?: DocumentStorage; artifacts?: typeof parseArtifactStorage }) {
  const job = await claimJob(); if (!job) return false;
  const storage = adapters?.storage ?? documentStorage;
  const artifacts = adapters?.artifacts ?? parseArtifactStorage;
  try {
    if (job.deadlineAt.getTime() <= Date.now()) throw new ParseError("MINERU_JOB_TIMEOUT");
    if (job.document.storageStatus !== "AVAILABLE" || job.document.parseVersion !== job.version || job.document.sha256 !== job.sourceSha256) throw new ParseError("PARSE_SOURCE_CHANGED");
    const mineru = adapters?.mineru ?? createMineruClient();
    if (job.phase === "RESERVE") {
      const remote = await mineru.reserve(job.id, job.sourceFilename, job.modelVersion);
      await checkpoint(job, { remoteBatchId: remote.batchId, uploadUrl: remote.uploadUrl, phase: "UPLOAD" });
    } else if (job.phase === "UPLOAD") {
      if (!job.uploadUrl || !job.remoteBatchId) throw new ParseError("PARSE_JOB_INVALID");
      const bytes = await storage.get(job.document.minioKey);
      if (bytes.length !== job.sourceSize || createHash("sha256").update(bytes).digest("hex") !== job.sourceSha256) throw new ParseError("PARSE_SOURCE_INTEGRITY");
      await mineru.upload(job.uploadUrl, bytes);
      await checkpoint(job, { phase: "POLL", uploadUrl: null });
    } else if (job.phase === "POLL") {
      if (!job.remoteBatchId) throw new ParseError("PARSE_JOB_INVALID");
      const remote = await mineru.poll(job.remoteBatchId, job.id, job.sourceFilename);
      if (remote.state === "failed") throw new ParseError("MINERU_PARSE_FAILED");
      if (remote.state === "pending") await checkpoint(job, {});
      else {
        if (!remote.resultUrl) throw new ParseError("MINERU_PROTOCOL");
        const result = await mineru.result(remote.resultUrl);
        const key = `projects/${job.document.projectId}/documents/${job.documentId}/parse/${job.id}/${job.leaseToken}.zip`;
        const hash = createHash("sha256").update(result.raw).digest("hex");
        const work = await prisma.$transaction((tx) => repository.queueParseArtifact(tx, job.documentId, job.document.projectId, job.id, key));
        await artifacts.put(key, result.raw, hash);
        await prisma.$transaction(async (tx) => {
          await lockProject(tx, job.document.projectId); await lockUsers(tx, [SYSTEM_USER_ID]);
          await repository.lockParseDocument(tx, job.documentId);
          const updated = await repository.updateParseJob(tx, { where: owned(job), data: { status: "SUCCEEDED", markdown: result.markdown, blocks: result.blocks, resultKey: key, resultSha256: hash, uploadUrl: null, errorCode: null, completedAt: new Date(), leaseUntil: null, leaseToken: null } });
          if (updated.count !== 1) throw new ParseError("PARSE_LEASE_LOST");
          const document = await repository.updateParseDocument(tx, { where: { id: job.documentId, parseVersion: job.version, sha256: job.sourceSha256 }, data: { parseStatus: "SUCCEEDED", parsedText: result.markdown, parsedVersion: job.version, parsedAt: new Date() } });
          if (document.count !== 1) throw new ParseError("PARSE_SOURCE_CHANGED");
          await repository.removeArtifactWork(tx, work.id);
          await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: job.document.projectId, action: "DOCUMENT_PARSE_SUCCEEDED", entityType: "DocumentParseJob", entityId: job.id, before: { status: "RUNNING" }, after: { documentId: job.documentId, version: job.version, provider: job.provider, modelVersion: job.modelVersion, resultSha256: hash, blockCount: result.blocks.length, requestedById: job.requestedById }, userAgent: "document-parser-worker" });
        });
      }
    } else throw new ParseError("PARSE_JOB_INVALID");
  } catch (error) { await recordFailure(job, error); }
  return true;
}
export async function cleanupParseArtifact(artifacts = parseArtifactStorage) {
  const work = await repository.artifactWork(); if (!work) return false;
  const job = await repository.loadArtifactJob(work.entityId);
  const payload = work.payload as { minioKey?: unknown };
  const key = payload?.minioKey;
  if (!job || typeof key !== "string" || !key.startsWith(`projects/${job.document.projectId}/documents/${job.documentId}/parse/${job.id}/`) || !/\/[a-f0-9-]{36}\.zip$/.test(key)) {
    await prisma.$transaction((tx) => repository.failArtifactWork(tx, work.id));
    return true;
  }
  if (job.resultKey !== key && job.leaseUntil && job.leaseUntil.getTime() > Date.now()) return false;
  try {
    if (job.resultKey !== key) await artifacts.remove(key);
    await prisma.$transaction(async (tx) => {
      await lockProject(tx, job.document.projectId); await lockUsers(tx, [SYSTEM_USER_ID]);
      await repository.removeArtifactWork(tx, work.id);
      await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId: job.document.projectId, action: "DOCUMENT_PARSE_ARTIFACT_CLEANED", entityType: "DocumentParseJob", entityId: job.id, after: { preservedReferencedResult: job.resultKey === key }, userAgent: "document-parser-worker" });
    });
  } catch { await prisma.$transaction((tx) => repository.failArtifactWork(tx, work.id)); }
  return true;
}
export async function runDocumentWorker(once = false, signal?: AbortSignal) {
  do {
    try { await runParseWorkerTick(); await cleanupParseArtifact(); await buildDocumentChunksTick(); await syncDocumentVectorTick(); }
    catch { console.error("Document parse worker iteration failed; pending leases remain recoverable"); }
    if (once || signal?.aborted) break;
    try { await delay(2000, undefined, { signal }); } catch { break; }
  } while (!signal?.aborted);
  await prisma.$disconnect();
}
