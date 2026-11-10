import { assertCheckFresh, CheckExpiredError, CheckGapsError, currentRules } from "./acceptance-check/service";
import { gapCount } from "./acceptance-check/types";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockProject, lockUsers } from "@/modules/auth/transaction-locks";
import { assertProjectAccessTx, ProjectAccessError } from "@/modules/auth/project-access";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { ProjectError } from "./services";
import { assertProjectStatusWritable } from "./freeze";
import { requirementAcceptance } from "@/modules/requirements/acceptance";

export const transitionSchema = z.object({ expectedRowVersion: z.number().int().positive(), requestKey: z.uuid(), acceptanceId: z.uuid().optional(), checkId: z.uuid().optional(), override: z.boolean().optional(), overrideReason: z.string().trim().min(20).max(2000).optional(), comment: z.string().trim().max(2000).default("") }).strict();
export type ProjectAction = "activate" | "submit-acceptance" | "qa-approve" | "archive" | "reject-acceptance" | "withdraw-acceptance";
type Actor = { actorId: string } & AuditRequestMetadata;
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const snapshotHash = (value: unknown) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
export async function acceptanceEvidence(tx: Prisma.TransactionClient, projectId: string, version = 1) {
  const [tasks, deliverables, signatures] = await Promise.all([
    tx.task.findMany({ where: { projectId }, select: { id: true, title: true, status: true, requiresDeliverable: true, actualHours: true, estimateHours: true, plannedStartDate: true, dueDate: true, completedAt: true, completionRoundId: true, signatureEvidenceVersion: true, cancelReason: true, cancelledAt: true, cancelledById: true, createdAt: true }, orderBy: { id: "asc" }, take: 5001 }),
    tx.deliverable.findMany({ where: { projectId }, select: { id: true, taskId: true, version: true, status: true, documentId: true, document: { select: { sha256: true, storageStatus: true } } }, orderBy: { id: "asc" }, take: 5001 }),
    tx.auditLog.findMany({ where: { projectId, entityType: "Task", action: version >= 4 ? { in: ["TASK_SIGNED_AND_COMPLETED", "TASK_CANCELLED"] } : "TASK_SIGNED_AND_COMPLETED" }, select: { id: true, action: true }, orderBy: { id: "asc" }, take: 20001 }),
  ]);
  if (tasks.length > 5000 || deliverables.length > 5000 || signatures.length > 20000) throw new ProjectError("项目证据超过当前结项快照范围，请联系管理员分批处理", 422);
  return { ...(version >= 5 ? { requirements: await requirementAcceptance(tx, projectId) } : {}), ...(version >= 2 ? { compliance: await currentRules(tx, projectId) } : {}), version, tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, requiresDeliverable: t.requiresDeliverable, actualHours: t.actualHours?.toString() ?? null, ...(version >= 3 ? { estimateHours: t.estimateHours?.toString() ?? null, plannedStartDate: t.plannedStartDate?.toISOString() ?? null, dueDate: t.dueDate?.toISOString() ?? null, completedAt: t.completedAt?.toISOString() ?? null, completionRoundId: t.completionRoundId, ...(version >= 4 ? { signatureEvidenceVersion: t.signatureEvidenceVersion, cancelReason: t.cancelReason, cancelledAt: t.cancelledAt?.toISOString() ?? null, cancelledById: t.cancelledById } : {}), createdAt: t.createdAt.toISOString() } : {}) })), deliverables: deliverables.map(d => ({ id: d.id, taskId: d.taskId, version: d.version, status: d.status, documentId: d.documentId, sha256: d.document.sha256, storageStatus: d.document.storageStatus })), ...(version >= 4 ? { cancellationAuditIds: signatures.filter(a => a.action === "TASK_CANCELLED").map(a => a.id) } : {}), signatureAuditIds: signatures.filter(a => a.action === "TASK_SIGNED_AND_COMPLETED").map(a => a.id) };
}
function assertComplete(snapshot: Awaited<ReturnType<typeof acceptanceEvidence>>) {
  const incomplete = snapshot.tasks.filter(t => !["DONE", "CANCELLED"].includes(t.status));
  const missing = snapshot.tasks.filter(t => t.status !== "CANCELLED" && t.requiresDeliverable && !snapshot.deliverables.some(d => d.taskId === t.id && d.status === "APPROVED" && d.storageStatus === "AVAILABLE" && d.sha256));
  if (!snapshot.tasks.some(t => t.status !== "CANCELLED")) throw new ProjectError("项目没有任务，不能提交验收", 400);
  if (incomplete.length || missing.length) throw new ProjectError(`不能提交验收：${incomplete.length} 个任务未完成，${missing.length} 个任务缺少已批准交付物。${[...new Set([...incomplete, ...missing].map(t => t.title))].slice(0, 5).join("、")}`, 400);
}
async function assertSnapshot(tx: Prisma.TransactionClient, acceptance: { projectId: string; snapshot: Prisma.JsonValue; snapshotSha256: string }) {
  const stored = acceptance.snapshot as { version?: number };
  const current = await acceptanceEvidence(tx, acceptance.projectId, stored.version === 5 ? 5 : stored.version === 4 ? 4 : stored.version === 3 ? 3 : stored.version === 2 ? 2 : 1);
  if (snapshotHash(acceptance.snapshot) !== acceptance.snapshotSha256 || snapshotHash(current) !== acceptance.snapshotSha256) throw new ProjectError("验收快照与当前证据不一致，可能发生数据变更或篡改；请驳回后重新提交", 409);
  assertComplete(current);
  if (!(await currentRules(tx, acceptance.projectId)).passed) throw new CheckGapsError();
}
async function lifecycleActor(tx: Prisma.TransactionClient, projectId: string, actorId: string) {
  await lockProject(tx, projectId); await lockUsers(tx, [actorId]); await assertProjectAccessTx(tx, actorId, projectId);
  const user = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { role: true, status: true, isSystem: true } });
  if (user.isSystem || user.status !== "ACTIVE") throw new ProjectAccessError("当前角色无权执行此结项操作");
  return user;
}
export async function transitionProject(projectId: string, action: ProjectAction, input: z.infer<typeof transitionSchema>, actor: Actor) {
  return prisma.$transaction(async tx => {
    if (action !== "submit-acceptance" && (input.override || input.overrideReason || input.checkId)) throw new ProjectError("此操作不接受验收例外参数", 400);
    const roles: Role[] = action === "qa-approve" || action === "reject-acceptance" ? ["QA"] : action === "archive" ? ["ADMIN"] : action === "submit-acceptance" && input.override ? ["ADMIN", "PM"] : ["PM"];
    const user = await lifecycleActor(tx, projectId, actor.actorId);
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    assertProjectStatusWritable(project.status, true);
    if (!roles.includes(user.role)) throw new ProjectAccessError("当前角色无权执行此结项操作");
    if (action === "submit-acceptance") {
      const prior = await tx.projectAcceptance.findUnique({ where: { projectId_requestKey: { projectId, requestKey: input.requestKey } } });
      if (prior && prior.id === project.currentAcceptanceId && prior.submittedById === actor.actorId) return { ...project, acceptanceId: prior.id };
      if (prior) throw new ProjectError("验收请求标识已用于其他轮次", 409);
    }
    if (action === "submit-acceptance" && input.checkId && project.rowVersion !== input.expectedRowVersion) throw new CheckExpiredError();
    if (project.rowVersion !== input.expectedRowVersion) throw new ProjectError("项目状态或验收轮次已变化，请刷新后重试", 409);
    if (action === "activate") {
      if (!["PLANNING", "COMPLETED"].includes(project.status)) throw new ProjectError("仅规划或历史兼容状态可进入执行", 409);
      const updated = await tx.project.update({ where: { id: projectId }, data: { status: "ACTIVE", rowVersion: { increment: 1 } } });
      await recordAudit(tx, { ...actor, projectId, action: "PROJECT_ACTIVATED", entityType: "Project", entityId: projectId, before: { status: project.status }, after: { status: updated.status } }); return updated;
    }
    if (action === "submit-acceptance") {
      if (project.status !== "ACTIVE") throw new ProjectError("请先将项目启动为进行中，再提交验收", 409);
      const rules = await currentRules(tx, projectId);
      if (input.checkId) await assertCheckFresh(tx, projectId, input.checkId, actor.actorId, rules, project.rowVersion);
      if (input.override) {
        if (!input.checkId || !input.overrideReason || input.overrideReason.trim().length < 20) throw new ProjectError("风险提交必须引用当前体检并填写至少 20 字的特权说明", 400);
        const user = await tx.user.findUniqueOrThrow({ where: { id: actor.actorId }, select: { role: true } });
        const grant = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: actor.actorId } } });
        if (user.role !== "ADMIN" && !(user.role === "PM" && grant?.active && grant.canOverrideAcceptance)) throw new ProjectAccessError("未获项目验收例外提交权限");
        const [integrity] = await tx.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) total FROM Deliverable d LEFT JOIN Document doc ON doc.id=d.documentId AND doc.projectId=d.projectId WHERE d.projectId=${projectId} AND d.status='APPROVED' AND (doc.id IS NULL OR doc.storageStatus<>'AVAILABLE' OR doc.sha256 IS NULL OR NOT (doc.sha256 REGEXP '^[a-fA-F0-9]{64}$'))`;
        if (Number(integrity.total)) throw new ProjectError("已批准交付物存在损坏或不可用的证据，禁止特权提交", 409);
        if (rules.passed) throw new ProjectError("体检已通过，请使用正常提交验收", 400);
        if (rules.counts.EMPTY_PROJECT) throw new ProjectError("空项目不可通过特权提交验收", 400);
      } else if (!rules.passed) throw new CheckGapsError();
      const snapshot = await acceptanceEvidence(tx, projectId, 5);
      const latest = await tx.projectAcceptance.findFirst({ where: { projectId }, orderBy: { round: "desc" }, select: { round: true } });
      const acceptance = await tx.projectAcceptance.create({ data: { projectId, round: (latest?.round ?? 0) + 1, requestKey: input.requestKey, submittedById: actor.actorId, snapshot, snapshotSha256: snapshotHash(snapshot), ...(input.override ? { overrideReason: input.overrideReason, overrideGapCount: gapCount(rules.counts), overrideCheckId: input.checkId } : {}) } });
      const updated = await tx.project.update({ where: { id: projectId }, data: { status: "PENDING_ACCEPTANCE", currentAcceptanceId: acceptance.id, rowVersion: { increment: 1 } } });
      if (input.override) await recordAudit(tx, { ...actor, projectId, action: "PROJECT_ACCEPTANCE_OVERRIDE_SUBMITTED", entityType: "ProjectAcceptance", entityId: acceptance.id, after: { checkId: input.checkId!, reason: input.overrideReason!, counts: rules.counts, fingerprint: rules.fingerprint, totalGaps: gapCount(rules.counts), snapshotSha256: acceptance.snapshotSha256 } });
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
