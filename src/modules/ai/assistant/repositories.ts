import { Prisma } from "@prisma/client";
import { ProjectAccessError, visibleProjectWhere } from "@/modules/auth/project-access";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { ProjectError } from "@/modules/projects/services";
export type Db = Prisma.TransactionClient;
export async function activeActor(db: Db, id: string, lock = false): Promise<AuthenticatedUser> {
  if (lock) await db.$queryRaw`SELECT id FROM User WHERE id=${id} FOR UPDATE`;
  const row = await db.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, isSystem: true } });
  if (!row || row.status !== "ACTIVE" || row.isSystem) throw new ProjectAccessError("账号或会话已失效", 401);
  return { id: row.id, role: row.role };
}
export async function projects(db: Db, actor: AuthenticatedUser, projectId?: string | null) {
  const rows = await db.project.findMany({ where: { ...visibleProjectWhere(actor), ...(projectId ? { id: projectId } : {}) }, select: { id: true, name: true }, orderBy: { id: "asc" }, take: 1001 });
  if (rows.length > 1000) throw new ProjectError("可访问项目较多，请选择单个项目后提问", 400);
  if (projectId && !rows.length) throw new ProjectAccessError(); return rows;
}
export async function ownedConversation(db: Db, id: string, actorId: string, lock = false) {
  if (lock) await db.$queryRaw`SELECT id FROM RagConversation WHERE id=${id} FOR UPDATE`;
  const row = await db.ragConversation.findFirst({ where: { id, userId: actorId, hiddenAt: null } });
  if (!row) throw new ProjectAccessError("会话不存在或不可访问", 404); return row;
}
export const contactSelect = { id: true, name: true, email: true } satisfies Prisma.UserSelect;
export async function contacts(db: Db, actor: AuthenticatedUser, projectIds: string[], term?: string, ids?: string[]) {
  return db.user.findMany({ where: { status: "ACTIVE", isSystem: false,
    ...(ids ? { id: { in: ids } } : {}), ...(term ? { OR: [{ name: { contains: term } }, { email: { contains: term } }] } : {}),
    AND: actor.role === "ADMIN" ? [] : [{ OR: [{ id: actor.id }, { ownedProjects: { some: { id: { in: projectIds } } } }, { projectMemberships: { some: { active: true, projectId: { in: projectIds } } } }] }],
  }, select: contactSelect, orderBy: [{ name: "asc" }, { id: "asc" }], take: 8 });
}
