import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { visibleProjectWhere } from "@/modules/auth/project-access";

export const issueInclude = {
  assignedTo: { select: { id: true, name: true } },
  project: { select: { name: true } },
} as const;
export function issueScope(
  actor: AuthenticatedUser,
  projectId?: string,
): Prisma.AuditIssueWhereInput {
  return {
    ...(projectId ? { projectId } : {}),
    project: { is: visibleProjectWhere(actor) },
    ...(actor.role === "MEMBER" ? { assignedToId: actor.id } : {}),
  };
}
export const listIssues = (
  actor: AuthenticatedUser,
  projectId?: string,
  status?: string,
  cursor?: string,
  overdue = false,
) =>
  prisma.auditIssue.findMany({
    where: {
      ...issueScope(actor, projectId),
      ...(status ? { status } : {}),
      ...(overdue
        ? {
            AND: [
              {
                status: { in: ["OPEN", "REMEDIATING", "VERIFYING"] },
                dueDate: { lt: new Date() },
              },
            ],
          }
        : {}),
    },
    include: issueInclude,
    take: 31,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
export const findIssue = (actor: AuthenticatedUser, id: string) =>
  prisma.auditIssue.findFirst({
    where: { ...issueScope(actor), id },
    include: {
      ...issueInclude,
      occurrences: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
      },
      events: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { actor: { select: { name: true } } },
      },
    },
  });
export const updateIssue = (
  tx: Prisma.TransactionClient,
  id: string,
  rowVersion: number,
  data: Prisma.AuditIssueUncheckedUpdateManyInput,
) =>
  tx.auditIssue.updateMany({
    where: { id, rowVersion },
    data: { ...data, rowVersion: { increment: 1 } },
  });
