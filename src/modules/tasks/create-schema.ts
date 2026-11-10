import { z } from "zod";
import { taskPlanSchema } from "./plan";
import { meetingTaskSourceSchema } from "@/modules/ai/meetings/types";
export const createTaskSchema = taskPlanSchema.safeExtend({
  title: z.string().trim().min(1).max(191),
  description: z.string().trim().max(9900).optional(),
  requiresDeliverable: z.boolean().optional(),
  assigneeId: z.uuid().optional(),
  requirementId: z.uuid().optional(),
  meetingSource: meetingTaskSourceSchema.optional(),
}).superRefine((value, context) => {
  if (!value.meetingSource && !value.dueDate) context.addIssue({ code: "custom", path: ["dueDate"], message: "请填写预计完成日期" });
});
