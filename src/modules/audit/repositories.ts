import { prisma } from "@/lib/prisma";
import type { AuditDisplayRow } from "./presentation";

/** Caller must scope audit rows first. Resolve only objects belonging to those projects. */
export async function enrichAuditRows<T extends AuditDisplayRow>(rows: T[]) {
  const projectIds = [
    ...new Set(rows.flatMap((r) => (r.projectId ? [r.projectId] : []))),
  ];
  const ids = rows.flatMap((r) => (r.entityId ? [r.entityId] : []));
  const userIds = new Set<string>();
  for (const row of rows)
    for (const value of [row.before, row.after])
      if (value && typeof value === "object")
        for (const [key, id] of Object.entries(value))
          if (
            ["assigneeId", "ownerId", "reviewedById", "assignedToId"].includes(
              key,
            ) &&
            typeof id === "string"
          )
            userIds.add(id);
  const [projects, tasks, requirements, users] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    }),
    prisma.task.findMany({
      where: { id: { in: ids }, projectId: { in: projectIds } },
      select: { id: true, title: true, projectId: true },
    }),
    prisma.requirement.findMany({
      where: { id: { in: ids }, projectId: { in: projectIds } },
      select: { id: true, title: true, projectId: true },
    }),
    prisma.user.findMany({
      where: {
        id: { in: [...userIds] },
        OR: [
          { ownedProjects: { some: { id: { in: projectIds } } } },
          {
            projectMemberships: {
              some: { projectId: { in: projectIds }, active: true },
            },
          },
        ],
      },
      select: { id: true, name: true },
    }),
  ]);
  // Asset visibility can be narrower than project visibility; names are resolved only for shared objects.
  const names = Object.fromEntries([
    ...projects.map((p) => [p.id, p.name]),
    ...tasks.map((t) => [t.id, t.title]),
    ...requirements.map((r) => [r.id, r.title]),
    ...users.map((u) => [u.id, u.name]),
  ]);
  return rows.map((row) => {
    const projectName = projects.find((p) => p.id === row.projectId)?.name;
    const target =
      row.entityType === "Task"
        ? tasks.find(
            (t) => t.id === row.entityId && t.projectId === row.projectId,
          )
        : row.entityType === "Requirement"
          ? requirements.find(
              (t) => t.id === row.entityId && t.projectId === row.projectId,
            )
          : null;
    const entityName =
      row.entityType === "Project" ? projectName : target?.title;
    const entityHref =
      row.entityType === "Task" && target
        ? `/tasks/${row.entityId}`
        : row.entityType === "Project" && projectName
          ? `/projects/${row.projectId}/board`
          : row.entityType === "Requirement" && target
            ? `/projects/${row.projectId}/requirements`
            : null;
    return { ...row, projectName, entityName, entityHref, names };
  });
}
