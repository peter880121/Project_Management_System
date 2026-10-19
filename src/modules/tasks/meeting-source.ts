import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { BusinessError } from "@/modules/audit/errors";
import { ProjectError } from "@/modules/projects/services";
import { assertDraft, loadMeetingTx, loadSuggestionTx, readItems } from "@/modules/ai/meetings/repository";
import type { meetingTaskSourceSchema } from "@/modules/ai/meetings/types";
export type MeetingTaskSource = z.infer<typeof meetingTaskSourceSchema>;
export async function prepareMeetingTask(tx: Prisma.TransactionClient, projectId: string, source: MeetingTaskSource) {
  try {
    const meeting = await loadMeetingTx(tx, projectId, source.meetingId, "PM");
    const items = readItems(meeting.actionItems);
    let item = items.find(item => item.id === source.actionItemId);
    // Project write lock serializes competing requests. Check the durable link before CAS:
    // a retry after a lost HTTP response must return its original task, even with an old version.
    if (item?.taskId) {
      const task = await tx.task.findFirst({ where: { id: item.taskId, projectId } });
      if (!task) throw new BusinessError("关联任务不存在，请联系管理员核对", 409);
      return { existing: task, meeting, items, item };
    }
    assertDraft(meeting, source.expectedVersion);
    if (!item && source.suggestionId) {
      const suggestion = await loadSuggestionTx(tx, projectId, meeting, source.suggestionId);
      item = suggestion.result.actionItems.find(item => item.id === source.actionItemId);
      if (item) items.push(item);
    }
    if (!item) throw new BusinessError("行动项不存在或来源不匹配", 400);
    if (items.length > 100) throw new BusinessError("行动项过多，请拆分会议", 400);
    return { existing: null, meeting, items, item };
  } catch (error) { if (error instanceof ProjectError) throw new BusinessError(error.message, error.status); throw error; }
}
