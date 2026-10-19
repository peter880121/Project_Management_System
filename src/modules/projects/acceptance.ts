import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockProject, lockUsers } from "@/modules/auth/transaction-locks";
import { assertProjectAccessTx, ProjectAccessError } from "@/modules/auth/project-access";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { ProjectError } from "./services";
import { ProjectFrozenError } from "./freeze";

export const transitionSchema = z.object({ expectedRowVersion: z.number().int().positive(), requestKey: z.uuid(), acceptanceId: z.uuid().optional(), comment: z.string().trim().max(2000).default("") }).strict();
export type ProjectAction = "activate" | "submit-acceptance" | "qa-approve" | "archive" | "reject-acceptance" | "withdraw-acceptance";
type Actor = { actorId: string } & AuditRequestMetadata;
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const snapshotHash = (value: unknown) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
export async function acceptanceEvidence(tx: Prisma.TransactionClient, projectId: string) {
  const [tasks, deliverables, signatures] = await Promise.all([
    tx.task.findMany({ where: { projectId }, select: { id: true, title: true, status: true, requiresDeliverable: true, actualHours: true }, orderBy: { id: "asc" }, take: 5001 }),
    tx.deliverable.findMany({ where: { projectId }, select: { id: true, taskId: true, version: true, status: true, documentId: true, document: { select: { sha256: true, storageStatus: true } } }, orderBy: { id: "asc" }, take: 5001 }),
    tx.auditLog.findMany({ where: { projectId, entityType: "Task", action: "TASK_SIGNED_AND_COMPLETED" }, select: { id: true }, orderBy: { id: "asc" }, take: 20001 }),
  ]);
  if (tasks.length > 5000 || deliverables.length > 5000 || signatures.length > 20000) throw new ProjectError("项目证据超过当前结项快照范围，请联系管理员分批处理", 422);
  return { version: 1, tasks: tasks.map(t => ({ ...t, actualHours: t.actualHours?.toString() ?? null })), deliverables: deliverables.map(d => ({ id: d.id, taskId: d.taskId, version: d.version, status: d.status, documentId: d.documentId, sha256: d.document.sha256, storageStatus: d.document.storageStatus })), signatureAuditIds: signatures.map(a => a.id) };
}
function assertComplete(snapshot: Awaited<ReturnType<typeof acceptanceEvidence>>) {
  const incomplete = snapshot.tasks.filter(t => t.status !== "DONE");
  const missing = snapshot.tasks.filter(t => t.requiresDeliverable && !snapshot.deliverables.some(d => d.taskId === t.id && d.status === "APPROVED" && d.storageStatus === "AVAILABLE" && d.sha256));
  if (!snapshot.tasks.length) throw new ProjectError("项目没有任务，不能提交验收", 400);
  if (incomplete.length || missing.length) throw new ProjectError(`不能提交验收：${incomplete.length} 个任务未完成，${missing.length} 个任务缺少已批准交付物。${[...new Set([...incomplete, ...missing].map(t => t.title))].slice(0, 5).join("、")}`, 400);
}
async function assertSnapshot(tx: Prisma.TransactionClient, acceptance: { projectId: string; snapshot: Prisma.JsonValue; snapshotSha256: string }) {
  const current = await acceptanceEvidence(tx, acceptance.projectId);
  if (snapshotHash(acceptance.snapshot) !== acceptance.snapshotSha256 || snapshotHash(current) !== acceptance.snapshotSha256) throw new ProjectError("验收快照与当前证据不一致，可能发生数据变更或篡改；请驳回后重新提交", 409);
  assertComplete(current);
}
async function lifecycleActor(tx: Prisma.TransactionClient, projectId: string, actorId: string, roles: Role[]) {
  await lockProject(tx, projectId); await lockUsers(tx, [actorId]); await assertProjectAccessTx(tx, actorId, projectId);
  const user = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { role: true, status: true, isSystem: true } });
  if (user.isSystem || user.status !== "ACTIVE" || !roles.includes(user.role)) throw new ProjectAccessError("当前角色无权执行此结项操作");
}
export async function transitionProject(projectId: string, action: ProjectAction, input: z.infer<typeof transitionSchema>, actor: Actor) {
  return prisma.$transaction(async tx => {
    const roles: Role[] = action === "qa-approve" || action === "reject-acceptance" ? ["QA"] : action === "archive" ? ["ADMIN"] : ["PM"];
    await lifecycleActor(tx, projectId, actor.actorId, roles);
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    if (project.status === "ARCHIVED") throw new ProjectFrozenError();
    if (action === "submit-acceptance") {
      const prior = await tx.projectAcceptance.findUnique({ where: { projectId_requestKey: { projectId, requestKey: input.requestKey } } });
      if (prior && prior.id === project.currentAcceptanceId && prior.submittedById === actor.actorId) return { ...project, acceptanceId: prior.id };
      if (prior) throw new ProjectError("验收请求标识已用于其他轮次", 409);
    }
    if (project.rowVersion !== input.expectedRowVersion) throw new ProjectError("项目状态或验收轮次已变化，请刷新后重试", 409);
    if (action === "activate") {
      if (!["PLANNING", "ON_HOLD", "COMPLETED"].includes(project.status)) throw new ProjectError("仅规划或历史兼容状态可进入执行", 409);
      const updated = await tx.project.update({ where: { id: projectId }, data: { status: "ACTIVE", rowVersion: { increment: 1 } } });
      await recordAudit(tx, { ...actor, projectId, action: "PROJECT_ACTIVATED", entityType: "Project", entityId: projectId, before: { status: project.status }, after: { status: updated.status } }); return updated;
    }
    if (action === "submit-acceptance") {
      if (project.status !== "ACTIVE") throw new ProjectError("请先将项目启动为进行中，再提交验收", 409);
      const snapshot = await acceptanceEvidence(tx, projectId); assertComplete(snapshot);
      const latest = await tx.projectAcceptance.findFirst({ where: { projectId }, orderBy: { round: "desc" }, select: { round: true } });
      const acceptance = await tx.projectAcceptance.create({ data: { projectId, round: (latest?.round ?? 0) + 1, requestKey: input.requestKey, submittedById: actor.actorId, snapshot, snapshotSha256: snapshotHash(snapshot) } });
      const updated = await tx.project.update({ where: { id: projectId }, data: { status: "PENDING_ACCEPTANCE", currentAcceptanceId: acceptance.id, rowVersion: { increment: 1 } } });
      await recordAudit(tx, { ...actor, projectId, action: "PROJECT_SUBMITTED", entityType: "Project", entityId: projectId, before: { status: project.status }, after: { status: updated.status, acceptanceId: acceptance.id, round: acceptance.round, snapshotSha256: acceptance.snapshotSha256 } }); return updated;
    }
    if (project.status !== "PENDING_ACCEPTANCE" || !project.currentAcceptanceId || input.acceptanceId !== project.currentAcceptanceId) throw new ProjectError("项目不在当前待验收轮次，请刷新", 409);
    const acceptance = await tx.projectAcceptance.findUniqueOrThrow({ where: { id: project.currentAcceptanceId } });
    if (acceptance.projectId !== projectId) throw new ProjectError("验收轮次与项目不匹配，禁止审批或归档", 409);
    if (["reject-acceptance", "withdraw-acceptance"].includes(action)) {
      if (!input.comment) throw new ProjectError("驳回或撤回必须填写原因", 400);
      await tx.projectAcceptance.update({ where: { id: acceptance.id }, data: { state: action === "reject-acceptance" ? "REJECTED" : "WITHDRAWN", reviewComment: input.comment, closedAt: new Date() } });
      const updated = await tx.project.update({ where: { id: projectId }, data: { status: "ACTIVE", currentAcceptanceId: null, rowVersion: { increment: 1 } } });
      await recordAudit(tx, { ...actor, projectId, action: action === "reject-acceptance" ? "PROJECT_ACCEPTANCE_REJECTED" : "PROJECT_ACCEPTANCE_WITHDRAWN", entityType: "Project", entityId: projectId, before: { status: project.status, acceptanceId: acceptance.id }, after: { status: updated.status, reason: input.comment } }); return updated;
    }
    await assertSnapshot(tx, acceptance);
    if (action === "qa-approve") {
      if (acceptance.state !== "SUBMITTED") throw new ProjectError("此验收轮次已经审查，请刷新", 409);
      if (acceptance.submittedById === actor.actorId) throw new ProjectAccessError("不能审查本人提交的验收");
      await tx.projectAcceptance.update({ where: { id: acceptance.id }, data: { state: "QA_APPROVED", qaApprovedById: actor.actorId, qaApprovedAt: new Date(), reviewComment: input.comment } });
      const updated = await tx.project.update({ where: { id: projectId }, data: { rowVersion: { increment: 1 } } });
      await recordAudit(tx, { ...actor, projectId, action: "PROJECT_QA_APPROVED", entityType: "Project", entityId: projectId, after: { acceptanceId: acceptance.id, snapshotSha256: acceptance.snapshotSha256, reviewerId: actor.actorId, comment: input.comment } }); return updated;
    }
    if (acceptance.state !== "QA_APPROVED" || !acceptance.qaApprovedAt || !acceptance.qaApprovedById) throw new ProjectError("请先由 QA 完成当前验收轮次的合规审查", 409);
    if ([acceptance.submittedById, acceptance.qaApprovedById].includes(actor.actorId)) throw new ProjectAccessError("最终归档须由独立 ADMIN 执行");
    const now = new Date();
    const busy = await tx.document.count({ where: { projectId, storageStatus: "UPLOADING" } }) + await tx.documentParseJob.count({ where: { document: { projectId }, leaseUntil: { gt: now } } }) + await tx.documentChunk.count({ where: { projectId, leaseUntil: { gt: now } } }) + await tx.assetSourceJob.count({ where: { document: { projectId }, leaseUntil: { gt: now } } }) + await tx.riskScanJob.count({ where: { projectId, leaseUntil: { gt: now } } });
    if (busy) throw new ProjectError("项目仍有上传或后台任务正在提交，请稍后重试归档", 409);
    await tx.documentParseJob.updateMany({ where: { document: { projectId }, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "FAILED", errorCode: "PROJECT_ARCHIVED", leaseToken: null, leaseUntil: null } });
    await tx.assetSourceJob.updateMany({ where: { document: { projectId }, status: { not: "COMPLETED" } }, data: { status: "CANCELLED", leaseToken: null, leaseUntil: null } });
    await tx.riskScanSchedule.updateMany({ where: { projectId }, data: { enabled: false } });
    await tx.riskScanJob.updateMany({ where: { projectId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "SKIPPED", errorCode: "PROJECT_ARCHIVED", leaseToken: null, leaseUntil: null, completedAt: now } });
    await tx.projectAcceptance.update({ where: { id: acceptance.id }, data: { state: "ARCHIVED", closedAt: now } });
    const recipients = await tx.user.findMany({ where: { status: "ACTIVE", isSystem: false, OR: [{ id: project.ownerId ?? "" }, { projectMemberships: { some: { projectId, active: true } } }] }, select: { id: true } });
    const updated = await tx.project.update({ where: { id: projectId }, data: { status: "ARCHIVED", archivedById: actor.actorId, archivedAt: now, rowVersion: { increment: 1 } } });
    await tx.projectNotification.createMany({ data: recipients.map(r => ({ projectId, acceptanceId: acceptance.id, recipientId: r.id })), skipDuplicates: true });
    await recordAudit(tx, { ...actor, projectId, action: "PROJECT_ARCHIVED", entityType: "Project", entityId: projectId, before: { status: project.status }, after: { status: "ARCHIVED", acceptanceId: acceptance.id, snapshotSha256: acceptance.snapshotSha256, notifiedUserIds: recipients.map(r => r.id) } }); return updated;
  }, { isolationLevel: "ReadCommitted", timeout: 15000 });
}
