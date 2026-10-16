import { z } from "zod";
export const planningDate = z.iso.date().refine((value) => value >= "2000-01-01" && value <= "2100-12-31", "日期范围为 2000–2100 年");
export const weekSchema = planningDate.refine((value) => new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1, "请选择周一");
export const scheduleSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  plannedStartDate: planningDate.nullable(),
  dueDate: planningDate.nullable(),
  estimateHours: z.number().positive().max(10000).multipleOf(0.01).nullable(),
  dependencyIds: z.array(z.uuid()).max(100).refine((ids) => new Set(ids).size === ids.length, "前置任务不可重复"),
}).strict().refine((value) => !value.plannedStartDate || !value.dueDate || value.plannedStartDate <= value.dueDate, "开始日期不能晚于截止日期");
export const capacitySchema = z.object({ weekStart: weekSchema, hours: z.number().min(0).max(168).multipleOf(0.01).nullable(), expectedVersion: z.number().int().nonnegative() }).strict();
export class PlanningError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
