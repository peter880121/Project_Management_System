import { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
export const dashboardRoles = ["ADMIN", "PMO", "PM"] as const;
export const operationalStatuses = ["PLANNING", "ACTIVE"] as const;
export function dashboardScope(actor: AuthenticatedUser, projectId?: string): Prisma.ProjectWhereInput {
  if (!dashboardRoles.some(role => role === actor.role)) return { id: { in: [] } };
  const access = actor.role === "PM" ? { OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id, active: true } } }] } : {};
  return { AND: [access, ...(projectId ? [{ id: projectId }] : [])] };
}
/** Same AND intersection as Prisma, bound parameters only; alias p is internal. */
export function dashboardSqlScope(actor: AuthenticatedUser, projectId?: string) {
  if (!dashboardRoles.some(role => role === actor.role)) return Prisma.sql`FALSE`;
  const access = actor.role === "PM" ? Prisma.sql`(p.ownerId = ${actor.id} OR EXISTS (SELECT 1 FROM ProjectMember m WHERE m.projectId = p.id AND m.userId = ${actor.id} AND m.active = TRUE))` : Prisma.sql`TRUE`;
  return Prisma.sql`${access} AND ${projectId ? Prisma.sql`p.id = ${projectId}` : Prisma.sql`TRUE`}`;
}
