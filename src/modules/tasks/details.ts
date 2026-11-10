import { prisma } from "@/lib/prisma";
import { lockBusinessActor, assertProjectAccessTx } from "@/modules/auth/project-access";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { BusinessError } from "@/modules/audit/errors";
import { assertTaskVersion, assertTaskWritable } from "./lifecycle";
import { taskDetailsSchema } from "./details-schema";
import { taskDescription } from "./plan";
export async function updateTaskDetails(taskId: string, raw: unknown, actor: { actorId: string } & AuditRequestMetadata) {
  const parsed = taskDetailsSchema.safeParse(raw);
  if (!parsed.success) throw new BusinessError("任务标题、说明或阶段无效", 400);
  const input = parsed.data;
  const scope = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!scope) throw new BusinessError("任务不存在", 404);
  return prisma.$transaction(async tx => {
    await lockBusinessActor(tx, actor.actorId, ["PM", "ADMIN"], scope.projectId);
    await assertProjectAccessTx(tx, actor.actorId, scope.projectId);
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    assertTaskWritable(task); assertTaskVersion(task, input.expectedRowVersion);
    if (task.status === "DONE") throw new BusinessError("已签署任务的内容只读，请先明确重新打开", 409);
    const changed = await tx.task.update({ where: { id: taskId, rowVersion: input.expectedRowVersion }, data: { title: input.title, description: taskDescription(input.phase, input.description) } });
    await recordAudit(tx, { ...actor, projectId: scope.projectId, action: "TASK_DETAILS_UPDATED", entityType: "Task", entityId: taskId, before: { title: task.title, description: task.description, rowVersion: task.rowVersion }, after: { title: changed.title, description: changed.description, phase: input.phase, rowVersion: changed.rowVersion } });
    return changed;
  }, { isolationLevel: "ReadCommitted" });
}
