import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PlanningError } from "./schemas";
import { lockProjectForWrite } from "@/modules/auth/transaction-locks";
export async function lockPlanningActor(tx: Prisma.TransactionClient, id: string, projectId?: string) {
  if (projectId) await lockProjectForWrite(tx, projectId);
  const [user] = await tx.$queryRaw<{ role: string; status: string; isSystem: boolean }[]>`SELECT role, status, isSystem FROM User WHERE id = ${id} FOR UPDATE`;
  if (!user || user.status !== "ACTIVE" || user.isSystem || user.role !== "PM") throw new PlanningError("仅有效 PM 账号可维护排期和容量", 403);
}
export const lockPlanningProject = lockProjectForWrite;
export const planningTaskProject = (id: string) => prisma.task.findUnique({ where: { id }, select: { projectId: true } });
export const planningTask = (tx: Prisma.TransactionClient, id: string) => tx.task.findUnique({ where: { id }, include: { dependencies: true } });
export const projectTasks = (tx: Prisma.TransactionClient, projectId: string) => tx.task.findMany({ where: { projectId }, include: { dependencies: true }, take: 5001, orderBy: { id: "asc" } });
export const updateSchedule = (tx: Prisma.TransactionClient, args: Prisma.TaskUpdateManyArgs) => tx.task.updateMany(args);
export const removeDependencies = (tx: Prisma.TransactionClient, taskId: string) => tx.taskDependency.deleteMany({ where: { taskId } });
export const insertDependencies = (tx: Prisma.TransactionClient, taskId: string, ids: string[]) => tx.taskDependency.createMany({ data: ids.map((dependsOnTaskId) => ({ taskId, dependsOnTaskId })) });
export const findMember = (tx: Prisma.TransactionClient, id: string) => tx.user.findUnique({ where: { id } });
export const findCapacity = (tx: Prisma.TransactionClient, userId: string, weekStart: Date) => tx.memberWeeklyCapacity.findUnique({ where: { userId_weekStart: { userId, weekStart } } });
export const saveCapacity = (tx: Prisma.TransactionClient, userId: string, weekStart: Date, hours: number | null) => tx.memberWeeklyCapacity.upsert({ where: { userId_weekStart: { userId, weekStart } }, create: { userId, weekStart, hours }, update: { hours, version: { increment: 1 } } });
export async function loadPlanningSnapshot(tx: Prisma.TransactionClient, projectId: string, weekStart: Date) {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true } }); if (!project) throw new PlanningError("项目不存在", 404);
  const tasks = await tx.task.findMany({ where: { projectId }, include: { dependencies: true, assignee: { select: { id: true, name: true } } }, orderBy: { id: "asc" }, take: 5001 });
  const members = await tx.user.findMany({ where: { isSystem: false, OR: [{ projectMemberships: { some: { projectId, active: true } } }, { ownedProjects: { some: { id: projectId } } }, { tasks: { some: { projectId, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } } } }] }, select: { id: true, name: true, status: true }, take: 1001, orderBy: { id: "asc" } });
  if (tasks.length > 5000 || members.length > 1000) throw new PlanningError("数据超过排期视图范围，请缩小项目或成员范围", 422);
  const capacities = await tx.memberWeeklyCapacity.findMany({ where: { userId: { in: members.map((member) => member.id) }, weekStart } });
  // Include all projects for these members; do not report a partial global load as complete.
  const loadTasks = await tx.task.findMany({ where: { assigneeId: { in: members.map((member) => member.id) }, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] }, project: { status: { in: ["PLANNING", "ACTIVE"] } } }, select: { id: true, title: true, projectId: true, assigneeId: true, status: true, plannedStartDate: true, dueDate: true, estimateHours: true }, orderBy: { id: "asc" }, take: 20001 });
  if (loadTasks.length > 20000) throw new PlanningError("跨项目任务超过容量统计范围，不能可靠判断负载", 422);
  return { project, tasks, members, capacities, loadTasks };
}
