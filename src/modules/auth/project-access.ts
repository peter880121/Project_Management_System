import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "./rbac";
import { lockProject, lockUsers } from "./transaction-locks";
export class ProjectAccessError extends Error { constructor(message = "无权访问此项目", readonly status = 403) { super(message); } }
/** Serialize role revocation with the business commit; HTTP checks alone can become stale. */
export async function lockBusinessActor(tx: Prisma.TransactionClient, actorId: string, roles: readonly Role[], projectId?: string, relatedUserIds: readonly string[] = []) {
  if (projectId) await lockProject(tx, projectId);
  if (relatedUserIds.length) await lockUsers(tx, [actorId, ...relatedUserIds]);
  const [actor] = await tx.$queryRaw<{ role: Role; status: string; isSystem: boolean }[]>`SELECT role, status, isSystem FROM User WHERE id = ${actorId} FOR UPDATE`;
  if (!actor || actor.status !== "ACTIVE" || actor.isSystem || !roles.includes(actor.role)) throw new ProjectAccessError("当前角色无权执行此操作");
  return actor;
}
export function visibleProjectWhere(user: AuthenticatedUser): Prisma.ProjectWhereInput {
  return user.role === "ADMIN" ? {} : { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id, active: true } } }] };
}
export async function hasProjectAccess(user: AuthenticatedUser, projectId: string) {
  return !!await prisma.project.findFirst({ where: { id: projectId, ...visibleProjectWhere(user) }, select: { id: true } });
}
export async function assertProjectAccess(user: AuthenticatedUser, projectId: string) {
  if (!await hasProjectAccess(user, projectId)) throw new ProjectAccessError();
}
/** The project lock serializes permission revocation with audited business commits. */
export async function assertProjectAccessTx(tx: Prisma.TransactionClient, actorId: string, projectId: string) {
  const [project] = await tx.$queryRaw<{ id: string; ownerId: string | null }[]>`SELECT id, ownerId FROM Project WHERE id = ${projectId} FOR UPDATE`;
  const [actor] = await tx.$queryRaw<{ role: string; status: string; isSystem: boolean }[]>`SELECT role, status, isSystem FROM User WHERE id = ${actorId} FOR UPDATE`;
  if (!actor) throw new ProjectAccessError();
  // System identities are only used by internal workers, never session authentication.
  if (actor.isSystem) return;
  if (actor.status !== "ACTIVE") throw new ProjectAccessError();
  if (!project) throw new ProjectAccessError();
  if (actor.role === "ADMIN" || project.ownerId === actorId) return;
  // Locking reads see revocations committed after an earlier RepeatableRead snapshot.
  const [membership] = await tx.$queryRaw<{ active: boolean }[]>`SELECT active FROM ProjectMember WHERE projectId = ${projectId} AND userId = ${actorId} FOR UPDATE`;
  if (!membership?.active) throw new ProjectAccessError();
}
export async function participant(tx: Prisma.TransactionClient, projectId: string, userId: string) {
  return !!await tx.project.findFirst({ where: { id: projectId, OR: [{ ownerId: userId }, { members: { some: { userId, active: true } } }] }, select: { id: true } });
}
