import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { assertProjectAccessTx, ProjectAccessError } from "@/modules/auth/project-access";
import { lockProjectForWrite, lockUsers } from "@/modules/auth/transaction-locks";
import { projectMaintenanceSchema } from "./maintenance-schema";
import { ProjectError } from "./services";

export async function maintainProject(projectId: string, raw: z.input<typeof projectMaintenanceSchema>, actor: { actorId: string } & AuditRequestMetadata) {
  const parsed = projectMaintenanceSchema.safeParse(raw);
  if (!parsed.success) throw new ProjectError("项目修改参数无效，交接说明须为 10–1000 字", 400);
  const input = parsed.data;
  return prisma.$transaction(async tx => {
    await lockProjectForWrite(tx, projectId);
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) throw new ProjectError("项目不存在", 404);
    await lockUsers(tx, [actor.actorId, ...(project.ownerId ? [project.ownerId] : []), ...(input.operation === "transfer" ? [input.ownerId] : [])]);
    await assertProjectAccessTx(tx, actor.actorId, projectId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.actorId }, select: { id: true, role: true, status: true, isSystem: true } });
    if (user.isSystem || user.status !== "ACTIVE" || !(user.role === "ADMIN" || user.role === "PM" && project.ownerId === user.id)) throw new ProjectAccessError("仅项目负责人或 ADMIN 可编辑项目和交接负责人");
    if (project.rowVersion !== input.expectedRowVersion) throw new ProjectError("项目已变化，请刷新后重新确认", 409);
    if (input.operation === "details") {
      const updated = await tx.project.update({ where: { id: projectId, rowVersion: input.expectedRowVersion }, data: { name: input.name, description: input.description, rowVersion: { increment: 1 } } });
      await recordAudit(tx, { ...actor, projectId, action: "PROJECT_DETAILS_UPDATED", entityType: "Project", entityId: projectId, before: { name: project.name, description: project.description, rowVersion: project.rowVersion }, after: { name: updated.name, description: updated.description, rowVersion: updated.rowVersion } });
      return updated;
    }
    if (input.confirmationName !== project.name) throw new ProjectError("请输入完整项目名称确认交接", 400);
    if (input.ownerId.toLowerCase() === project.ownerId?.toLowerCase()) throw new ProjectError("新负责人不能与当前负责人相同", 400);
    const target = await tx.user.findUnique({ where: { id: input.ownerId }, select: { id: true, role: true, status: true, isSystem: true } });
    if (!target || target.status !== "ACTIVE" || target.isSystem || target.role !== "PM") throw new ProjectError("新负责人必须是有效的 PM 账号", 400);
    // Membership and ownership move atomically; never copy an override grant to the successor.
    for (const id of [...new Set([project.ownerId, target.id].filter((value): value is string => !!value))]) {
      const prior = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: id } } });
      const membership = await tx.projectMember.upsert({ where: { projectId_userId: { projectId, userId: id } }, create: { projectId, userId: id, active: true }, update: { active: true, ...(id === project.ownerId ? { canOverrideAcceptance: false } : {}), version: { increment: 1 } } });
      await recordAudit(tx, { ...actor, projectId, action: "PROJECT_MEMBER_UPDATED", entityType: "ProjectMember", entityId: membership.id, before: { active: prior?.active ?? false, version: prior?.version ?? 0 }, after: { userId: id, active: true, version: membership.version, reason: "项目负责人交接" } });
      if (prior?.canOverrideAcceptance && !membership.canOverrideAcceptance) await recordAudit(tx, { ...actor, projectId, action: "ACCEPTANCE_OVERRIDE_PERMISSION_CHANGED", entityType: "ProjectMember", entityId: membership.id, before: { canOverrideAcceptance: true }, after: { userId: id, canOverrideAcceptance: false, reason: "原负责人交接后撤销例外权限" } });
    }
    const updated = await tx.project.update({ where: { id: projectId, rowVersion: input.expectedRowVersion }, data: { ownerId: target.id, rowVersion: { increment: 1 } } });
    await recordAudit(tx, { ...actor, projectId, action: "PROJECT_OWNER_TRANSFERRED", entityType: "Project", entityId: projectId, before: { ownerId: project.ownerId, rowVersion: project.rowVersion }, after: { ownerId: updated.ownerId, rowVersion: updated.rowVersion, reason: input.reason, previousOwnerRetainedAsMember: true } });
    return updated;
  }, { isolationLevel: "ReadCommitted", timeout: 15000 });
}
