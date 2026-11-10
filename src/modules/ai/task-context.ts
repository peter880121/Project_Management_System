import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProjectError } from "@/modules/projects/services";
import { canRefineTask, canCheckTaskEvidence } from "./task-actions";

export async function loadAiTask(projectId: string, taskId: string, action: "wbs" | "compliance", db: Pick<Prisma.TransactionClient, "task"> = prisma) {
  const task = await db.task.findFirst({ where: { id: taskId, projectId }, select: { id: true, status: true, title: true, description: true, updatedAt: true, requirement: { select: { id: true, title: true, content: true, version: true } }, dependencies: { select: { dependsOn: { select: { id: true, title: true, status: true } } } } } });
  if (task?.status === "CANCELLED") throw new ProjectError("任务已取消，不能再生成或采纳任务建议", 409);
  if (!task) throw new ProjectError("项目内未找到来源任务", 404);
  if (!(action === "wbs" ? canRefineTask(task.title) : canCheckTaskEvidence(task.title))) throw new ProjectError("当前任务名称不支持此 AI 操作，请刷新看板", 400);
  return task;
}
