import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
// Queue only; the normal document worker performs embedding and v2 writes.
if (!process.argv.includes("--confirm")) throw new Error("Use --confirm after vector:init; original documents collection is preserved");
const db = new PrismaClient(); const actorId = "00000000-0000-4000-8000-000000000000";
try {
  const system = await db.user.findFirst({ where: { isSystem: true }, select: { id: true } }); if (!system) throw new Error("System audit identity required");
  const projects = await db.project.findMany({ select: { id: true } }); let total = 0;
  for (const project of projects) total += await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM Project WHERE id = ${project.id} FOR UPDATE`;
    const changed = await tx.documentChunk.updateMany({ where: { projectId: project.id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { vectorStatus: "PENDING", attempts: 0, nextRunAt: new Date(), errorCode: null, leaseUntil: null, leaseToken: null } });
    await tx.auditLog.create({ data: { actorId: system.id || actorId, projectId: project.id, action: "VECTOR_SYNC_RETRIED", entityType: "Project", entityId: project.id, after: { requestId: randomUUID(), target: "documents_v2", queuedChunks: changed.count }, userAgent: "documents-v2-backfill" } }); return changed.count;
  });
  console.log(`Queued ${total} chunks for v2; active leases untouched, rerun after they finish if necessary`);
} finally { await db.$disconnect(); }
