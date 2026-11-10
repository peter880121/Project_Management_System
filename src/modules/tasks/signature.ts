import { z } from "zod";
import { completionDateSchema, effortHoursSchema } from "./plan";

export const SIGNATURE_REASONS = [
  "确认任务已完成",
  "确认会议已完成",
  "确认计划编制完成",
  "确认需求与方案评审通过",
  "确认配置与联调完成",
  "确认开发完成",
  "确认测试通过",
  "确认数据迁移完成",
  "确认培训已完成",
  "批准发布上线",
  "确认验收与移交完成",
] as const;
export const signatureSchema = z.object({
  signaturePassword: z.string().min(1).refine(value => new TextEncoder().encode(value).length <= 72, "密码超出允许长度"),
  signatureReason: z.enum(SIGNATURE_REASONS),
});
export type TaskSignature = z.infer<typeof signatureSchema>;
export const taskCompletionSchema = signatureSchema.extend({
  status: z.literal("DONE"),
  actualHours: effortHoursSchema,
  completedAt: completionDateSchema,
  expectedRowVersion: z.number().int().positive().optional(),
  expectedCompletionRoundId: z.uuid().nullable().optional(),
}).strict();
