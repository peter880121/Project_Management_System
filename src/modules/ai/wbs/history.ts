import { prisma } from "@/lib/prisma";
import { embedTaskText } from "@/modules/ai/embeddings";
import { searchTaskHistory, upsertTaskHistoryVector } from "@/modules/vector/task-history";
import type { HistoricalTask } from "./types";

export type HistoryRetrieval = Readonly<{
  tasks: HistoricalTask[];
  hitIds: string[];
  degraded: boolean;
  durationMs: number;
}>;

export type HistoryAdapters = Readonly<{
  embed: (text: string) => Promise<number[]>;
  vectorSearch: (projectId: string, embedding: number[]) => Promise<string[]>;
  loadByIds: (projectId: string, ids: string[]) => Promise<HistoricalTask[]>;
  keywordSearch: (projectId: string, query: string) => Promise<HistoricalTask[]>;
  indexFallbacks?: (tasks: HistoricalTask[], projectId: string) => Promise<void>;
}>;

function getDeliveryDays(createdAt: Date, completedAt: Date): number {
  return Math.max(0, Math.round(((completedAt.getTime() - createdAt.getTime()) / 86_400_000) * 100) / 100);
}

async function loadByIds(projectId: string, ids: string[]): Promise<HistoricalTask[]> {
  if (ids.length === 0) return [];
  const records = await prisma.task.findMany({
    where: { id: { in: ids }, projectId, status: "DONE", actualHours: { not: null }, completedAt: { not: null } },
    select: { id: true, title: true, description: true, actualHours: true, createdAt: true, completedAt: true },
  });
  const byId = new Map(records.map((task) => [task.id, task]));
  return ids.flatMap((id) => {
    const task = byId.get(id);
    if (!task?.actualHours || !task.completedAt) return [];
    return [{ id, title: task.title, description: task.description, actualHours: Number(task.actualHours), deliveryDays: getDeliveryDays(task.createdAt, task.completedAt) }];
  });
}

async function keywordSearch(projectId: string, query: string): Promise<HistoricalTask[]> {
  const terms = [...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1))].slice(0, 8);
  if (terms.length === 0) return [];
  const records = await prisma.task.findMany({
    where: {
      projectId,
      status: "DONE",
      actualHours: { not: null },
      completedAt: { not: null },
      OR: terms.flatMap((term) => [
        { title: { contains: term } },
        { description: { contains: term } },
      ]),
    },
    select: { id: true, title: true, description: true, actualHours: true, createdAt: true, completedAt: true },
    orderBy: [{ completedAt: "desc" }, { id: "asc" }],
    take: 8,
  });
  return records.flatMap((task) => task.actualHours && task.completedAt ? [{
    id: task.id,
    title: task.title,
    description: task.description,
    actualHours: Number(task.actualHours),
    deliveryDays: getDeliveryDays(task.createdAt, task.completedAt),
  }] : []);
}

export const productionHistoryAdapters: HistoryAdapters = {
  embed: embedTaskText,
  vectorSearch: (projectId, embedding) => searchTaskHistory({ projectId, embedding, limit: 8 }),
  loadByIds,
  keywordSearch,
  async indexFallbacks(tasks, projectId) {
    await Promise.all(tasks.map(async (task) => {
      const vectorText = `${task.title}\n${task.description ?? ""}`;
      try {
        const previousFailure = await prisma.syncFailure.findFirst({
          where: { entityType: "Task", entityId: task.id, target: "MILVUS_TASK_HISTORY" },
          select: { retryCount: true },
        });
        if (previousFailure && previousFailure.retryCount >= 5) return;
        const embedding = await embedTaskText(vectorText);
        await upsertTaskHistoryVector({ taskId: task.id, projectId, embedding });
        await prisma.$transaction((tx) => tx.syncFailure.deleteMany({ where: { entityType: "Task", entityId: task.id, target: "MILVUS_TASK_HISTORY" } }));
      } catch {
        const message = "Task history embedding or Milvus upsert failed; a later keyword fallback may retry it.";
        await prisma.$transaction(async (tx) => {
          const failure = await tx.syncFailure.findFirst({ where: { entityType: "Task", entityId: task.id, target: "MILVUS_TASK_HISTORY" } });
          if (failure) {
            await tx.syncFailure.update({ where: { id: failure.id }, data: { retryCount: { increment: 1 }, error: message } });
          } else {
            await tx.syncFailure.create({ data: {
              projectId,
              entityType: "Task",
              entityId: task.id,
              target: "MILVUS_TASK_HISTORY",
              payload: { taskId: task.id },
              error: message,
            } });
          }
        });
      }
    }));
  },
};

export async function retrieveHistoricalTasks(projectId: string, query: string, adapters: HistoryAdapters = productionHistoryAdapters): Promise<HistoryRetrieval> {
  const startedAt = Date.now();
  let degraded = false;
  let tasks: HistoricalTask[] = [];
  try {
    const vector = await adapters.embed(query);
    const hitIds = await adapters.vectorSearch(projectId, vector);
    tasks = await adapters.loadByIds(projectId, hitIds);
    if (tasks.length > 0) return { tasks, hitIds: tasks.map((task) => task.id), degraded: false, durationMs: Date.now() - startedAt };
  } catch {
    degraded = true;
  }
  degraded = true;
  tasks = await adapters.keywordSearch(projectId, query);
  if (tasks.length > 0 && adapters.indexFallbacks) await adapters.indexFallbacks(tasks, projectId);
  return { tasks, hitIds: tasks.map((task) => task.id), degraded, durationMs: Date.now() - startedAt };
}
