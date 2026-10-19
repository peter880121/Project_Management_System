import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DASHBOARD_TIMEZONE } from "./calendar";
import { dashboardRoles } from "./scope";
import type { DashboardQuery } from "./schemas";
import type { DashboardStats } from "./types";
import { dashboardRows, findDashboardActor } from "./repositories";
export class DashboardAccessError extends Error {}
const pageSize = 20;

export async function dashboardStats(actorId: string, query: DashboardQuery, now = new Date()): Promise<DashboardStats> {
  return prisma.$transaction(async tx => {
    const actor = await findDashboardActor(tx, actorId);
    if (!actor || actor.isSystem || actor.status !== "ACTIVE" || !dashboardRoles.some(role => role === actor.role)) throw new DashboardAccessError();
    const { states, overdueTasks, unsignedTasks, workload, unassigned, projects, activeCount, trend, visibleRows, people, taskCounts, overdueCounts, riskCounts } = await dashboardRows(tx, actor, query, now);
    const peopleById = new Map(people.map(p => [p.id, p]));
    return {
      generatedAt: now.toISOString(), timezone: DASHBOARD_TIMEZONE, scope: actor.role === "PM" ? "PARTICIPATING" : "GLOBAL",
      metrics: { activeProjects: states.find(s => s.status === "ACTIVE")?._count._all ?? 0, archivedProjects: states.find(s => s.status === "ARCHIVED")?._count._all ?? 0, overdueTasks, unsignedTasks },
      workload: { rows: visibleRows.map(r => ({ assigneeId: r.assigneeId!, name: peopleById.get(r.assigneeId!)?.name ?? "未命名成员", role: peopleById.get(r.assigneeId!)?.role ?? "", count: r._count.id })), unassigned, page: query.loadPage, hasMore: workload.length > pageSize },
      health: { rows: projects.map(p => {
        const counts = taskCounts.filter(c => c.projectId === p.id); const total = counts.reduce((sum, c) => sum + c._count._all, 0); const done = counts.find(c => c.status === "DONE")?._count._all ?? 0;
        return { ...p, total, done, progress: total ? Math.round(done / total * 100) : null, blocked: counts.find(c => c.status === "BLOCKED")?._count._all ?? 0, overdue: overdueCounts.find(c => c.projectId === p.id)?._count._all ?? 0, recentRisks: riskCounts.find(c => c.projectId === p.id)?._count._all ?? 0 };
      }), total: activeCount, page: query.healthPage }, trend,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000, maxWait: 5000 });
}
