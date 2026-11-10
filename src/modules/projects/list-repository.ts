import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleProjectWhere } from "@/modules/auth/project-access";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { projectListWhere, projectListOrder, PROJECT_PAGE_SIZE, type ProjectListQuery } from "./list-query";
export async function listProjects(user: AuthenticatedUser, query: ProjectListQuery) {
  const visible = visibleProjectWhere(user); const where = projectListWhere(visible, query);
  // A read snapshot keeps counts, status chips and pagination consistent during updates.
  return prisma.$transaction(async tx => {
    const [total, groups, created] = await Promise.all([
      tx.project.count({ where }),
      tx.project.groupBy({ by: ["status"], where: projectListWhere(visible, query, false), _count: { _all: true } }),
      query.created ? tx.project.findFirst({ where: { AND: [visible, { id: query.created }] }, select: { id: true, name: true } }) : Promise.resolve(null),
    ]);
    const pages = Math.max(1, Math.ceil(total / PROJECT_PAGE_SIZE)); const page = Math.min(query.page, pages);
    const projects = await tx.project.findMany({ where, select: { id: true, name: true, description: true, status: true, createdAt: true, _count: { select: { tasks: { where: { status: { not: "CANCELLED" } } } } } }, orderBy: projectListOrder(query), skip: (page - 1) * PROJECT_PAGE_SIZE, take: PROJECT_PAGE_SIZE });
    const counts = Object.fromEntries(groups.map(group => [group.status, group._count._all]));
    return { total, pages, page, projects, counts, allCount: groups.reduce((sum, group) => sum + group._count._all, 0), created };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
