import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lockProject, lockUsers } from "@/modules/auth/transaction-locks";
import { assertProjectAccessTx, ProjectAccessError } from "@/modules/auth/project-access";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { ProjectError } from "./services";
import { ProjectFrozenError } from "./freeze";

const fields = { expectedRowVersion: z.number().int().positive(), requestKey: z.uuid(), reason: z.string().trim().min(10, "请填写至少 10 字的说明").max(1000, "说明不能超过 1000 字") };
export const lifecycleSchema = z.object(fields).strict();
export const cancelProjectSchema = z.object({ ...fields, confirmationName: z.string().min(1).max(191) }).strict();
export type LifecycleAction = "pause" | "resume" | "cancel";
export function resumeStatus(pausedFromStatus: string | null): "PLANNING" | "ACTIVE" {
  return pausedFromStatus === "PLANNING" ? "PLANNING" : "ACTIVE";
}
export async function changeProjectLifecycle(projectId: string, action: LifecycleAction, raw: unknown, actor: { actorId: string } & AuditRequestMetadata) {
  const parsed = (action === "cancel" ? cancelProjectSchema : lifecycleSchema).safeParse(raw);
  if (!parsed.success) throw new ProjectError(parsed.error.issues[0]?.message ?? "状态变更参数无效", 400);
  const input = parsed.data;
  return prisma.$transaction(async tx => {
    // Dedicated lifecycle transition, not an exemption for general business writes.
    await lockProject(tx, projectId); await lockUsers(tx, [actor.actorId]);
    await assertProjectAccessTx(tx, actor.actorId, projectId);
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.actorId }, select: { role: true, status: true, isSystem: true } });
    if (user.status !== "ACTIVE" || user.isSystem || !(user.role === "ADMIN" || user.role === "PM" && project.ownerId === actor.actorId)) throw new ProjectAccessError("仅项目负责人 PM 或 ADMIN 可以暂停、恢复或取消项目");
    if (action === "cancel" && (!("confirmationName" in input) || input.confirmationName !== project.name)) throw new ProjectError("请输入完全一致的项目名称以确认取消", 400);
    const prior = await tx.projectStatusChange.findUnique({ where: { projectId_requestKey: { projectId, requestKey: input.requestKey } } });
    if (prior) {
      if (prior.actorId !== actor.actorId || prior.action !== action || prior.reason !== input.reason || prior.expectedRowVersion !== input.expectedRowVersion) throw new ProjectError("请求标识已用于其他状态变更，请刷新后重试", 409);
      return { project, change: prior, replayed: true };
    }
    if (["ARCHIVED", "CANCELLED"].includes(project.status)) throw new ProjectFrozenError(project.status);
    if (project.rowVersion !== input.expectedRowVersion) throw new ProjectError("项目状态已变化，请刷新后重试", 409);
    if (project.status === "PENDING_ACCEPTANCE") throw new ProjectError("请先撤回或驳回当前验收，再暂停或取消项目", 409);
    const target = action === "pause" && ["PLANNING", "ACTIVE"].includes(project.status) ? "ON_HOLD" : action === "resume" && project.status === "ON_HOLD" ? resumeStatus(project.pausedFromStatus) : action === "cancel" && ["PLANNING", "ACTIVE", "ON_HOLD"].includes(project.status) ? "CANCELLED" : null;
    if (!target) throw new ProjectError("当前项目状态不允许此操作", 409);
    const change = await tx.projectStatusChange.create({ data: { projectId, action, fromStatus: project.status, toStatus: target, reason: input.reason, actorId: actor.actorId, requestKey: input.requestKey, expectedRowVersion: project.rowVersion } });
    const updated = await tx.project.update({ where: { id: projectId, rowVersion: input.expectedRowVersion }, data: { status: target, pausedFromStatus: action === "pause" ? project.status : null, currentStatusChangeId: change.id, rowVersion: { increment: 1 } } });
    await recordAudit(tx, { ...actor, projectId, action: action === "pause" ? "PROJECT_PAUSED" : action === "resume" ? "PROJECT_RESUMED" : "PROJECT_CANCELLED", entityType: "Project", entityId: projectId, before: { status: project.status, pausedFromStatus: project.pausedFromStatus, rowVersion: project.rowVersion }, after: { status: updated.status, pausedFromStatus: updated.pausedFromStatus, rowVersion: updated.rowVersion, reason: input.reason, changeId: change.id, requestKey: input.requestKey } });
    return { project: updated, change, replayed: false };
  }, { isolationLevel: "ReadCommitted", timeout: 15000 });
}
