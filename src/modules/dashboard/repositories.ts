import { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { SIGNATURE_REASONS } from "@/modules/tasks/signature";
import { dashboardSqlScope } from "./scope";
import { sixMonthWindows } from "./calendar";
import { dashboardScope, operationalStatuses } from "./scope";
import type { DashboardQuery } from "./schemas";

/** AuditLog has no Task FK: perform the anti-join entirely in MySQL, never in JS. */
export async function unsignedTaskCount(tx: Prisma.TransactionClient, actor: AuthenticatedUser, projectId?: string) {
  const rows = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS count FROM Task t JOIN Project p ON p.id = t.projectId
    WHERE ${dashboardSqlScope(actor, projectId)} AND t.status = 'DONE'
      AND NOT EXISTS (
        SELECT 1 FROM AuditLog a WHERE a.projectId = t.projectId AND a.entityType = 'Task'
        AND a.entityId = t.id AND a.action = 'TASK_SIGNED_AND_COMPLETED'
        AND JSON_UNQUOTE(JSON_EXTRACT(a.after, '$.status')) = 'DONE'
        AND JSON_UNQUOTE(JSON_EXTRACT(a.after, '$.signatureReason')) IN (${Prisma.join([...SIGNATURE_REASONS])})
        AND JSON_UNQUOTE(JSON_EXTRACT(a.after, '$.completedAt')) = CONCAT(
          DATE_FORMAT(t.completedAt, '%Y-%m-%dT%H:%i:%s.'), LPAD(FLOOR(MICROSECOND(t.completedAt) / 1000), 3, '0'), 'Z')
      )`);
  return Number(rows[0].count);
}

const pageSize = 20;
export const findDashboardActor = (tx: Prisma.TransactionClient, id: string) => tx.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, isSystem: true } });
export async function dashboardRows(tx: Prisma.TransactionClient, actor: AuthenticatedUser, query: DashboardQuery, now: Date) {
    const scope = dashboardScope(actor, query.projectId);
    const operational: Prisma.ProjectWhereInput = { AND: [scope, { status: { in: [...operationalStatuses] } }] };
    const active: Prisma.ProjectWhereInput = { AND: [scope, { status: "ACTIVE" }] };
    const taskScope: Prisma.TaskWhereInput = { project: operational, status: { not: "DONE" } };
    // All queries aggregate in MySQL. Promise.all schedules work; a transaction uses one connection.
    const [states, overdueTasks, unsignedTasks, workload, unassigned, projects, activeCount, trend] = await Promise.all([
      tx.project.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
      tx.task.count({ where: { ...taskScope, dueDate: { lt: now } } }),
      unsignedTaskCount(tx, actor, query.projectId),
      tx.task.groupBy({ by: ["assigneeId"], where: { ...taskScope, assigneeId: { not: null } }, _count: { id: true }, orderBy: [{ _count: { id: "desc" } }, { assigneeId: "asc" }], skip: (query.loadPage - 1) * pageSize, take: pageSize + 1 }),
      tx.task.count({ where: { ...taskScope, assigneeId: null } }),
      tx.project.findMany({ where: active, select: { id: true, name: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.healthPage - 1) * pageSize, take: pageSize }),
      tx.project.count({ where: active }),
      Promise.all(sixMonthWindows(now).map(async window => {
        const [archivedProjects, deliverableVersions] = await Promise.all([
          tx.project.count({ where: { AND: [scope, { status: "ARCHIVED", archivedAt: { gte: window.start, lt: window.end } }] } }),
          tx.deliverable.count({ where: { project: scope, createdAt: { gte: window.start, lt: window.end } } }),
        ]); return { month: window.month, archivedProjects, deliverableVersions };
      })),
    ]);
    const ids = projects.map(p => p.id);
    const visibleRows = workload.slice(0, pageSize);
    const [people, taskCounts, overdueCounts, riskCounts] = await Promise.all([
      tx.user.findMany({ where: { id: { in: visibleRows.flatMap(r => r.assigneeId ? [r.assigneeId] : []) } }, select: { id: true, name: true, role: true }, take: pageSize }),
      tx.task.groupBy({ by: ["projectId", "status"], where: { project: active, projectId: { in: ids } }, _count: { _all: true } }),
      tx.task.groupBy({ by: ["projectId"], where: { project: active, projectId: { in: ids }, status: { not: "DONE" }, dueDate: { lt: now } }, _count: { _all: true } }),
      tx.aiSuggestion.groupBy({ by: ["projectId"], where: { project: active, projectId: { in: ids }, type: "RISK", status: "PENDING", createdAt: { gte: new Date(now.getTime() - 7 * 86400000), lte: now } }, _count: { _all: true } }),
    ]);
    return { states, overdueTasks, unsignedTasks, workload, unassigned, projects, activeCount, trend, visibleRows, people, taskCounts, overdueCounts, riskCounts };
}
