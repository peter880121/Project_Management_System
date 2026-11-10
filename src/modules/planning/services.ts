import { assertTaskWritable } from "@/modules/tasks/lifecycle";
import { z } from "zod";
import { calendarDateTime } from "@/modules/tasks/plan";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { calculateWeeklyLoad, wouldCreateCycle } from "./rules";
import { capacitySchema, scheduleSchema, PlanningError } from "./schemas";
import * as repository from "./repositories";
import { assertProjectAccessTx, ProjectAccessError, visibleProjectWhere } from "@/modules/auth/project-access";
import { lockProjectForWrite, lockUsers } from "@/modules/auth/transaction-locks";
type Actor = { actorId: string } & AuditRequestMetadata;
export async function updateTaskSchedule(id: string, input: z.infer<typeof scheduleSchema>, actor: Actor) {
  const scope = await repository.planningTaskProject(id); if (!scope) throw new PlanningError("任务不存在", 404);
  return prisma.$transaction(async (tx) => {
    await repository.lockPlanningActor(tx, actor.actorId, scope.projectId);
    const task = await repository.planningTask(tx, id); if (!task) throw new PlanningError("任务不存在", 404);
    assertTaskWritable(task);
    if (task.status === "DONE") throw new PlanningError("已完成任务不允许改写排期，请先明确重新打开");
    if (task.scheduleVersion !== input.expectedVersion) throw new PlanningError("排期已被更新，请刷新后重试");
    const tasks = await repository.projectTasks(tx, scope.projectId);
    if (tasks.length > 5000) throw new PlanningError("项目依赖图超过维护范围", 422);
    const allowed = new Set(tasks.filter(row => row.status !== "CANCELLED").map((row) => row.id));
    if (input.dependencyIds.some((dependency) => !allowed.has(dependency))) throw new PlanningError("前置任务必须属于同一项目且未取消", 400);
    if (wouldCreateCycle(id, input.dependencyIds, tasks.flatMap((row) => row.dependencies.map((edge) => ({ taskId: row.id, dependsOnTaskId: edge.dependsOnTaskId }))))) throw new PlanningError("依赖会形成循环，无法保存", 400);
    const changed = await repository.updateSchedule(tx, { where: { id, scheduleVersion: input.expectedVersion, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } }, data: { plannedStartDate: input.plannedStartDate ? calendarDateTime(input.plannedStartDate) : null, dueDate: input.dueDate ? calendarDateTime(input.dueDate) : null, estimateHours: input.estimateHours, scheduleVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new PlanningError("任务状态或排期已变化，请刷新");
    await repository.removeDependencies(tx, id); if (input.dependencyIds.length) await repository.insertDependencies(tx, id, input.dependencyIds);
    await recordAudit(tx, { ...actor, projectId: scope.projectId, action: "TASK_SCHEDULE_UPDATED", entityType: "Task", entityId: id,
      before: { plannedStartDate: task.plannedStartDate?.toISOString() ?? null, dueDate: task.dueDate?.toISOString() ?? null, estimateHours: task.estimateHours === null ? null : Number(task.estimateHours), dependencyIds: task.dependencies.map((edge) => edge.dependsOnTaskId), version: task.scheduleVersion },
      after: { ...input, version: input.expectedVersion + 1, dateConvention: "UTC-normalized calendar dates; signing time is separate" } });
    return { id, scheduleVersion: input.expectedVersion + 1 };
  }, { isolationLevel: "ReadCommitted" });
}
export async function updateMemberCapacity(userId: string, input: z.infer<typeof capacitySchema>, actor: Actor) {
  const sharedProject = userId === actor.actorId ? null : await prisma.project.findFirst({ where: { AND: [visibleProjectWhere({ id: actor.actorId, role: "PM" }), { OR: [{ ownerId: userId }, { members: { some: { userId, active: true } } }, { tasks: { some: { assigneeId: userId } } }] }] }, select: { id: true } });
  if (userId !== actor.actorId && !sharedProject) throw new ProjectAccessError("只能维护所参与项目的成员容量");
  return prisma.$transaction(async (tx) => {
    if (sharedProject) await lockProjectForWrite(tx, sharedProject.id);
    await lockUsers(tx, [actor.actorId, userId]);
    await repository.lockPlanningActor(tx, actor.actorId);
    const user = await repository.findMember(tx, userId); if (!user || user.isSystem || user.status !== "ACTIVE") throw new PlanningError("仅可设置有效成员容量", 400);
    if (sharedProject) {
      await assertProjectAccessTx(tx, actor.actorId, sharedProject.id);
      const targetScope = await tx.project.findFirst({ where: { id: sharedProject.id, OR: [{ ownerId: userId }, { members: { some: { userId, active: true } } }, { tasks: { some: { assigneeId: userId } } }] }, select: { id: true } });
      if (!targetScope) throw new ProjectAccessError("成员项目授权已变化，请刷新");
    }
    const weekStart = new Date(`${input.weekStart}T00:00:00.000Z`); const previous = await repository.findCapacity(tx, userId, weekStart);
    if ((previous?.version ?? 0) !== input.expectedVersion) throw new PlanningError("成员容量已变化，请刷新");
    const row = await repository.saveCapacity(tx, userId, weekStart, input.hours);
    await recordAudit(tx, { ...actor, action: "MEMBER_CAPACITY_UPDATED", entityType: "MemberWeeklyCapacity", entityId: row.id, before: { hours: previous?.hours === null || !previous ? null : Number(previous.hours), version: previous?.version ?? 0 }, after: { userId, weekStart: input.weekStart, hours: input.hours, version: row.version, scope: "ALL_PROJECTS" } });
    return { id: row.id, version: row.version };
  }, { isolationLevel: "ReadCommitted" });
}
export async function getProjectPlanning(projectId: string, weekStart: Date) {
  return prisma.$transaction(async (tx) => {
    const data = await repository.loadPlanningSnapshot(tx, projectId, weekStart);
    const loads = calculateWeeklyLoad(data.loadTasks.map((row) => ({ ...row, estimateHours: row.estimateHours === null ? null : Number(row.estimateHours) })), data.members, data.capacities.map((row) => ({ ...row, hours: row.hours === null ? null : Number(row.hours) })), weekStart);
    const ownIds = new Set(data.tasks.map((task) => task.id));
    const privateLoads = loads.map((load) => ({ ...load, projectCount: load.projectIds.length, taskCount: load.taskIds.length, incompleteTaskCount: load.incompleteTaskIds.length, taskIds: load.taskIds.filter((id) => ownIds.has(id)), projectIds: load.projectIds.filter((id) => id === projectId), incompleteTaskIds: load.incompleteTaskIds.filter((id) => ownIds.has(id)) }));
    return { weekStart: weekStart.toISOString().slice(0, 10), tasks: data.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, assignee: task.assignee, plannedStartDate: task.plannedStartDate?.toISOString().slice(0, 10) ?? null, dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null, planningStatus: task.planningStatus, estimateHours: task.estimateHours === null ? null : Number(task.estimateHours), scheduleVersion: task.scheduleVersion, dependencyIds: task.dependencies.map((edge) => edge.dependsOnTaskId) })), members: data.members, loads: privateLoads };
  }, { isolationLevel: "RepeatableRead" });
}
