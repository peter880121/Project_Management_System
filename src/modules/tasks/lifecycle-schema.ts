import { z } from "zod";
export const taskCancelSchema = z.object({ status: z.literal("CANCELLED"), cancelReason: z.string().trim().min(10, "请填写至少 10 字的取消原因").max(1000), expectedRowVersion: z.number().int().positive() }).strict();
