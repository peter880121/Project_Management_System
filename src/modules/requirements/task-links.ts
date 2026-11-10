import type { Prisma } from "@prisma/client";
import { ProjectError } from "@/modules/projects/services";
/** Caller holds the shared project/actor lock and writes the enclosing audit. */
export async function attachRequirementTask(tx: Prisma.TransactionClient, projectId: string, requirementId: string, taskId: string, actorId: string) {
  const [requirement, task] = await Promise.all([
    tx.requirement.findFirst({ where: { id: requirementId, projectId } }),
    tx.task.findFirst({ where: { id: taskId, projectId, status: { not: "CANCELLED" } } }),
  ]);
  if (!requirement || !task) throw new ProjectError("任务或需求不属于当前项目", 400);
  if (requirement.managed && !["DRAFT", "APPROVED", "IMPLEMENTING"].includes(requirement.workflowState)) throw new ProjectError("当前需求已锁定实施关联，请先发起变更或退回整改", 409);
  await tx.requirementTaskLink.upsert({ where: { requirementId_taskId: { requirementId, taskId } }, create: { projectId, requirementId, taskId, createdById: actorId }, update: {} });
  return { requirement, task };
}
