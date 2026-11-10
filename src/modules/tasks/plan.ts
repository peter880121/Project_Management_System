import { z } from "zod";
import { planningDate } from "@/modules/planning/schemas";

export const effortHoursSchema = z.number().finite().positive("工时必须大于 0").max(10000, "工时不能超过 10000 小时").multipleOf(0.01, "工时最多保留两位小数");
export const phaseSchema = z.string().trim().min(1, "请选择所属阶段").max(50).refine(value => !/[\r\n\x00-\x1f\x7f]/.test(value), "阶段名称不能包含换行或控制字符");
export function businessToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
/** Calendar-date encoding, not a claim about the actual instant of signing. */
export const calendarDateTime = (value: string) => new Date(`${planningDate.parse(value)}T00:00:00.000Z`);
export const dateLabel = (value?: string | Date | null) => value ? (typeof value === "string" ? value : value.toISOString()).slice(0, 10) : "未填写";
export const completionDateSchema = planningDate.refine(value => value <= businessToday(), "实际完成日期不能晚于今天");
export const taskPlanSchema = z.object({
  phase: phaseSchema,
  estimateHours: effortHoursSchema,
  dueDate: planningDate.nullable(),
  plannedStartDate: planningDate.nullable().default(null),
}).strict().refine(value => !value.plannedStartDate || !value.dueDate || value.plannedStartDate <= value.dueDate, "预计开始日期不能晚于预计完成日期");
export type TaskPlanInput = z.input<typeof taskPlanSchema>;
export function taskDescription(phase: string, description: string) {
  const body = description.split(/\r?\n/).filter(line => !/^[\t ]*所属阶段[\t ]*[:：]/.test(line)).join("\n").trim();
  return `所属阶段：${phaseSchema.parse(phase)}${body ? `\n${body}` : ""}`;
}
export function taskPlanData(input: TaskPlanInput, description = "") {
  const plan = taskPlanSchema.parse({ phase: input.phase, estimateHours: input.estimateHours, dueDate: input.dueDate, plannedStartDate: input.plannedStartDate });
  return { description: taskDescription(plan.phase, description), estimateHours: plan.estimateHours, dueDate: plan.dueDate ? calendarDateTime(plan.dueDate) : null, plannedStartDate: plan.plannedStartDate ? calendarDateTime(plan.plannedStartDate) : null };
}
