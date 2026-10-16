import { scheduleSchema } from "./schemas";

export function scheduleFormInput(form: FormData, expectedVersion: number) {
  const value = (name: string) => String(form.get(name) ?? "").trim();
  return { expectedVersion, plannedStartDate: value("start") || null, dueDate: value("due") || null,
    estimateHours: value("hours") ? Number(value("hours")) : null, dependencyIds: form.getAll("dependency").map(String) };
}

export function scheduleValidationMessage(input: unknown): string | null {
  const parsed = scheduleSchema.safeParse(input);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  const field = issue.path[0];
  if (field === "plannedStartDate") return "开始日期无效，请选择 2000–2100 年内的有效日期";
  if (field === "dueDate") return "截止日期无效，请选择 2000–2100 年内的有效日期";
  if (field === "estimateHours") return "预计工时需大于 0、最多 10000 小时，且不超过两位小数；未知时请留空";
  if (field === "dependencyIds") return "前置任务无效，请刷新后重新选择同一项目中的任务";
  if (field === "expectedVersion") return "排期版本无效，请刷新后重试";
  return "开始日期不能晚于截止日期";
}
