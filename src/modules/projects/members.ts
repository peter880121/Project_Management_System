import { z } from "zod";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { assertProjectAccessTx, visibleProjectWhere, ProjectAccessError } from "@/modules/auth/project-access";
import { lockProjectForWrite, lockUsers } from "@/modules/auth/transaction-locks";
export const memberSchema = z.object({ userId: z.uuid(), canOverrideAcceptance: z.boolean().optional(), active: z.boolean(), expectedVersion: z.number().int().nonnegative() }).strict();
export async function setProjectMember(projectId: string, input: z.infer<typeof memberSchema>, actor: { actorId: string } & AuditRequestMetadata) {
  return prisma.$transaction(async (tx) => {
    await lockProjectForWrite(tx, projectId);
    await lockUsers(tx, [actor.actorId, input.userId]);
    await assertProjectAccessTx(tx, actor.actorId, projectId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.actorId } }); const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    if (user.role !== "ADMIN" && (user.role !== "PM" || project.ownerId !== actor.actorId)) throw new ProjectAccessError("仅负责人或 ADMIN 可维护项目成员");
    if (!input.active && input.userId === project.ownerId) throw new ProjectAccessError("负责人访问权不能通过移出成员撤销", 409);
    const target = await tx.user.findUnique({ where: { id: input.userId } }); if (!target || target.isSystem || input.active && target.status !== "ACTIVE") throw new ProjectAccessError("请选择有效用户", 400);
    if (input.canOverrideAcceptance !== undefined && user.role !== "ADMIN") throw new ProjectAccessError("仅 ADMIN 可授予或撤销验收例外权限");
    if (input.canOverrideAcceptance && (!input.active || target.role !== "PM")) throw new ProjectAccessError("验收例外权限仅可授予当前项目的有效 PM", 400);
    const prior = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: input.userId } } });
    if ((prior?.version ?? 0) !== input.expectedVersion) throw new ProjectAccessError("成员授权已变化，请刷新", 409);
    const canOverrideAcceptance = input.canOverrideAcceptance ?? (input.active && prior?.active ? prior.canOverrideAcceptance : false);
    const row = await tx.projectMember.upsert({ where: { projectId_userId: { projectId, userId: input.userId } }, create: { projectId, userId: input.userId, active: input.active, canOverrideAcceptance }, update: { active: input.active, canOverrideAcceptance, version: { increment: 1 } } });
    await recordAudit(tx, { ...actor, projectId, action: "PROJECT_MEMBER_UPDATED", entityType: "ProjectMember", entityId: row.id, before: { active: prior?.active ?? false, version: prior?.version ?? 0 }, after: { userId: input.userId, active: row.active, version: row.version } });
    if (canOverrideAcceptance !== (prior?.canOverrideAcceptance ?? false)) await recordAudit(tx, { ...actor, projectId, action: "ACCEPTANCE_OVERRIDE_PERMISSION_CHANGED", entityType: "ProjectMember", entityId: row.id, before: { canOverrideAcceptance: prior?.canOverrideAcceptance ?? false }, after: { userId: input.userId, canOverrideAcceptance } });
    return { id: row.id, version: row.version };
  }, { isolationLevel: "ReadCommitted" });
}
export async function getProjectMembers(projectId: string, actor: AuthenticatedUser) {
  if (actor.role === "PMO") throw new ProjectAccessError();
  const project = await prisma.project.findFirst({ where: { id: projectId, ...visibleProjectWhere(actor) }, select: { id: true, ownerId: true } }); if (!project) throw new ProjectAccessError();
  const canManage = actor.role === "ADMIN" || actor.role === "PM" && project.ownerId === actor.id;
  const [members, candidates] = await Promise.all([
    prisma.projectMember.findMany({ where: { projectId }, include: { user: { select: { id: true, name: true, role: true, status: true } } }, orderBy: { userId: "asc" }, take: 1001 }),
    canManage ? prisma.user.findMany({ where: { isSystem: false, status: "ACTIVE" }, select: { id: true, name: true, role: true }, take: 1001, orderBy: { name: "asc" } }) : [],
  ]);
  if (members.length > 1000 || candidates.length > 1000) throw new ProjectAccessError("成员目录超过展示范围", 422);
  return { ownerId: project.ownerId, canManage, members, candidates };
}
