import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { assertProjectAccessTx, ProjectAccessError } from "@/modules/auth/project-access";
import { lockProject, lockUsers } from "@/modules/auth/transaction-locks";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { complianceExportStorage, type DocumentStorage } from "@/modules/documents/storage";
import { traceabilityCsv, MAX_EXPORT_BYTES } from "./report";
import * as repository from "./repositories";
export const exportSchema = z.object({ requestKey: z.uuid(), format: z.enum(["csv", "json"]), from: z.iso.datetime().optional(), to: z.iso.datetime().optional() }).strict().refine((input) => !input.from || !input.to || Date.parse(input.from) <= Date.parse(input.to), "时间范围无效");
type Actor = { actorId: string } & AuditRequestMetadata;
async function authorize(tx: import("@prisma/client").Prisma.TransactionClient, projectId: string, actorId: string) {
  await lockProject(tx, projectId);
  const [actor] = await tx.$queryRaw<{ role: string; status: string; isSystem: boolean }[]>`SELECT role, status, isSystem FROM User WHERE id = ${actorId} FOR UPDATE`;
  if (!actor || actor.isSystem || actor.status !== "ACTIVE" || !["ADMIN", "QA"].includes(actor.role)) throw new ProjectAccessError("仅有效 ADMIN 或 QA 可导出");
  await assertProjectAccessTx(tx, actorId, projectId);
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function exported(tx: import("@prisma/client").Prisma.TransactionClient, row: Awaited<ReturnType<typeof repository.exportByIdTx>>, actor: Actor) {
  await recordAudit(tx, { ...actor, projectId: row.projectId, action: "DATA_EXPORTED", entityType: "ComplianceExport", entityId: row.id, after: { format: row.format, scope: row.scope, sha256: row.sha256, fileSize: row.fileSize } });
}
export async function generateComplianceExport(projectId: string, input: z.infer<typeof exportSchema>, actor: Actor, storage: DocumentStorage = complianceExportStorage) {
  const prepared = await prisma.$transaction(async (tx) => {
    await authorize(tx, projectId, actor.actorId);
    const prior = await repository.exportRequest(tx, projectId, input.requestKey);
    if (prior) {
      if (prior.format !== input.format || JSON.stringify(prior.scope && typeof prior.scope === "object" && !Array.isArray(prior.scope) ? [prior.scope.from, prior.scope.to] : []) !== JSON.stringify([input.from ?? null, input.to ?? null])) throw new ProjectAccessError("导出请求标识已用于其他范围", 409);
      if (prior.status !== "AVAILABLE") throw new ProjectAccessError("导出尚未就绪或已失败，请刷新并创建新导出", 409);
      return { row: prior, bytes: null };
    }
    const data = await repository.exportSnapshot(tx, projectId, input.from ? new Date(input.from) : undefined, input.to ? new Date(input.to) : undefined);
    if ([data.requirements, data.tasks, data.testCases, data.auditLogs].some((rows) => rows.length > 5000)) throw new ProjectAccessError("导出超过单类 5000 条范围，请缩小审计时间范围或项目规模", 422);
    const id = randomUUID(); const generatedAt = new Date().toISOString();
    const scope = { projectId, from: input.from ?? null, to: input.to ?? null, generatedAt, businessState: "CURRENT_SNAPSHOT", auditTimeFilterOnly: true, counts: { requirements: data.requirements.length, tasks: data.tasks.length, testCases: data.testCases.length, audits: data.auditLogs.length }, latestSummaryId: data.latestSummary?.id ?? null };
    let bytes: Buffer;
    try { bytes = input.format === "csv" ? traceabilityCsv({ exportId: id, generatedAt }, data.requirements, data.tasks, data.testCases) : Buffer.from(JSON.stringify({ exportId: id, generatedBy: actor.actorId, scope, notice: "业务数据为当前一致性快照；时间过滤仅作用于审计事件；报告不代表合规批准。", ...data }, null, 2), "utf8"); }
    catch { throw new ProjectAccessError("追溯矩阵超过 20000 行导出范围", 422); }
    if (bytes.length > MAX_EXPORT_BYTES) throw new ProjectAccessError("导出超过 10 MB，请缩小范围", 422);
    const row = await repository.insertExport(tx, { id, projectId, actorId: actor.actorId, requestKey: input.requestKey, format: input.format, scope, minioKey: `projects/${projectId}/exports/${id}.${input.format}`, sha256: sha(bytes), fileSize: bytes.length });
    await recordAudit(tx, { ...actor, projectId, action: "COMPLIANCE_EXPORT_PREPARED", entityType: "ComplianceExport", entityId: id, after: { scope, format: input.format, sha256: row.sha256, fileSize: row.fileSize } });
    return { row, bytes };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  if (!prepared.bytes) return downloadComplianceExport(prepared.row.id, actor, storage);
  const { row, bytes } = prepared;
  try {
    await storage.put(row.minioKey, bytes, row.sha256);
    await prisma.$transaction(async (tx) => {
      await authorize(tx, projectId, actor.actorId);
      const updated = await repository.updateExport(tx, { where: { id: row.id, status: "GENERATING" }, data: { status: "AVAILABLE" } }); if (updated.count !== 1) throw new ProjectAccessError("导出状态已变化", 409);
      await exported(tx, row, actor);
    }, { isolationLevel: "ReadCommitted" });
    return { id: row.id, format: row.format, bytes };
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await lockProject(tx, projectId); await lockUsers(tx, [SYSTEM_USER_ID]);
      const changed = await repository.updateExport(tx, { where: { id: row.id, status: "GENERATING" }, data: { status: "FAILED", errorCode: "EXPORT_STORAGE_OR_AUTHORIZATION_FAILED" } });
      if (!changed.count) return;
      await repository.queueExportCleanup(tx, row.id, projectId, row.minioKey);
      await recordAudit(tx, { actorId: SYSTEM_USER_ID, projectId, action: "COMPLIANCE_EXPORT_FAILED", entityType: "ComplianceExport", entityId: row.id, after: { requestedById: actor.actorId, errorCode: "EXPORT_STORAGE_OR_AUTHORIZATION_FAILED" }, userAgent: "compliance-export-service" });
    });
    if (error instanceof ProjectAccessError) throw error;
    throw new ProjectAccessError("导出文件保存失败，请稍后创建新导出", 503);
  }
}
export async function downloadComplianceExport(id: string, actor: Actor, storage: DocumentStorage = complianceExportStorage) {
  const row = await repository.exportById(id); if (!row) throw new ProjectAccessError("导出不存在", 404);
  await prisma.$transaction((tx) => authorize(tx, row.projectId, actor.actorId));
  if (row.status !== "AVAILABLE") throw new ProjectAccessError("导出尚不可下载", 409);
  const bytes = await storage.get(row.minioKey);
  if (bytes.length > MAX_EXPORT_BYTES || bytes.length !== row.fileSize || sha(bytes) !== row.sha256) throw new ProjectAccessError("导出文件完整性校验失败", 502);
  await prisma.$transaction(async (tx) => { await authorize(tx, row.projectId, actor.actorId); const latest = await repository.exportByIdTx(tx, id); if (latest.status !== "AVAILABLE") throw new ProjectAccessError("导出状态已变化", 409); await exported(tx, latest, actor); });
  return { id, format: row.format, bytes };
}
export async function cleanupComplianceExport(id: string, actor: Actor, storage: DocumentStorage = complianceExportStorage) {
  const row = await repository.exportById(id); if (!row) throw new ProjectAccessError("导出不存在", 404);
  await prisma.$transaction(async (tx) => {
    await authorize(tx, row.projectId, actor.actorId); const latest = await repository.exportByIdTx(tx, id);
    if (latest.status === "AVAILABLE" || latest.status === "GENERATING" && latest.createdAt.getTime() > Date.now() - 600000) throw new ProjectAccessError("仅失败或中断超过十分钟的导出可清理", 409);
    if (latest.status === "GENERATING") { await repository.updateExport(tx, { where: { id, status: "GENERATING" }, data: { status: "FAILED", errorCode: "EXPORT_INTERRUPTED" } }); await repository.queueExportCleanup(tx, id, row.projectId, row.minioKey); await recordAudit(tx, { ...actor, projectId: row.projectId, action: "COMPLIANCE_EXPORT_FAILED", entityType: "ComplianceExport", entityId: id, after: { errorCode: "EXPORT_INTERRUPTED" } }); }
  });
  await storage.remove(row.minioKey);
  await prisma.$transaction(async (tx) => { await authorize(tx, row.projectId, actor.actorId); await repository.clearExportCleanup(tx, id); await recordAudit(tx, { ...actor, projectId: row.projectId, action: "COMPLIANCE_EXPORT_CLEANED", entityType: "ComplianceExport", entityId: id, after: { status: "FAILED", artifactRemoved: true } }); });
  return { id, artifactRemoved: true };
}
export function exportResponse(result: { id: string; format: string; bytes: Buffer }) {
  return new Response(new Uint8Array(result.bytes), { headers: { "Content-Type": result.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="compliance-${result.id}.${result.format}"`, "Content-Length": String(result.bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
