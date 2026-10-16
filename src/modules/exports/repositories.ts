import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
export const exportById = (id: string) => prisma.complianceExport.findUnique({ where: { id } });
export const exportByIdTx = (tx: Prisma.TransactionClient, id: string) => tx.complianceExport.findUniqueOrThrow({ where: { id } });
export const exportRequest = (tx: Prisma.TransactionClient, projectId: string, requestKey: string) => tx.complianceExport.findUnique({ where: { projectId_requestKey: { projectId, requestKey } } });
export const insertExport = (tx: Prisma.TransactionClient, data: Prisma.ComplianceExportUncheckedCreateInput) => tx.complianceExport.create({ data });
export const updateExport = (tx: Prisma.TransactionClient, args: Prisma.ComplianceExportUpdateManyArgs) => tx.complianceExport.updateMany(args);
export const listExports = (projectId: string) => prisma.complianceExport.findMany({ where: { projectId }, select: { id: true, actorId: true, format: true, status: true, sha256: true, fileSize: true, scope: true, errorCode: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
export async function exportSnapshot(tx: Prisma.TransactionClient, projectId: string, from?: Date, to?: Date) {
  const requirements = await tx.requirement.findMany({ where: { projectId }, orderBy: { id: "asc" }, take: 5001 });
  const tasks = await tx.task.findMany({ where: { projectId }, orderBy: { id: "asc" }, take: 5001 });
  const testCases = await tx.testCase.findMany({ where: { requirement: { projectId } }, orderBy: { id: "asc" }, take: 5001 });
  const auditLogs = await tx.auditLog.findMany({ where: { projectId, ...(from || to ? { createdAt: { gte: from, lte: to } } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 5001 });
  const latestSummary = await tx.aiSuggestion.findFirst({ where: { projectId, type: "AUDIT_SUMMARY" }, select: { id: true, status: true, input: true, output: true, createdAt: true, reviewedAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return { requirements, tasks, testCases, auditLogs, latestSummary };
}
export const queueExportCleanup = (tx: Prisma.TransactionClient, id: string, projectId: string, key: string) => tx.syncFailure.create({ data: { projectId, entityType: "ComplianceExport", entityId: id, target: "MINIO_EXPORT_CLEANUP", payload: { minioKey: key }, error: "Export artifact cleanup pending" } });
export const clearExportCleanup = (tx: Prisma.TransactionClient, id: string) => tx.syncFailure.deleteMany({ where: { entityId: id, target: "MINIO_EXPORT_CLEANUP" } });
