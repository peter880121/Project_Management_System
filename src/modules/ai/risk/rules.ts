import { businessToday, calendarDateTime, dateLabel } from "@/modules/tasks/plan";
export type RiskTask = {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
  dueDate: Date | null;
  plannedStartDate?: Date | null;
  completedAt: Date | null;
  assignee: { id: string; name: string } | null;
  dependencies: { id: string; title: string; status: RiskTask["status"]; dueDate?: Date | null }[];
};

export type RiskFinding = {
  taskId: string;
  taskTitle: string;
  severity: "HIGH" | "MEDIUM";
  evidence: string[];
  relatedTaskIds: string[];
  historicalDelayRate: number | null;
  historySampleSize: number;
  capacityEvidence?: { weekStart: string; plannedHours: number; capacityHours: number | null; taskIds: string[]; projectIds: string[]; incompleteTaskIds: string[]; taskCount: number; projectCount: number; incompleteTaskCount: number; referencesTruncated: boolean };
};

export function analyzeProjectRisks(tasks: RiskTask[], now = new Date(), options: { dueSoonDays?: number; overloadThreshold?: number; historyWindowDays?: number } = {}): RiskFinding[] {
  const dueSoonDays = options.dueSoonDays ?? 7;
  const overloadThreshold = options.overloadThreshold ?? 3;
  const historyWindowDays = options.historyWindowDays ?? 14;
  const dayMs = 86_400_000;
  const today = calendarDateTime(businessToday(now)).getTime();
  const dateValue = (date: Date) => calendarDateTime(dateLabel(date)).getTime();
  const dueSoon = today + dueSoonDays * dayMs;
  const historyWindow = today + historyWindowDays * dayMs;
  const completedWithDueDate = tasks.filter((task) => task.status === "DONE" && task.dueDate && task.completedAt);
  const overdueCount = completedWithDueDate.filter((task) => dateValue(task.completedAt!) > dateValue(task.dueDate!)).length;
  const delayRate = completedWithDueDate.length ? overdueCount / completedWithDueDate.length : null;
  const loadByAssignee = new Map<string, RiskTask[]>();
  for (const task of tasks) {
    if (["DONE", "CANCELLED"].includes(task.status) || !task.assignee || !task.dueDate) continue;
    if (dateValue(task.dueDate) <= dueSoon) loadByAssignee.set(task.assignee.id, [...(loadByAssignee.get(task.assignee.id) ?? []), task]);
  }
  const findings: RiskFinding[] = [];
  for (const task of tasks) {
    if (["DONE", "CANCELLED"].includes(task.status)) continue;
    const evidence: string[] = [];
    const relatedTaskIds = new Set<string>();
    if (task.dueDate && dateValue(task.dueDate) < today) {
      evidence.push("截止日期已过 " + Math.ceil((today - dateValue(task.dueDate)) / dayMs) + " 天，任务尚未完成。");
    } else if (task.status === "TODO" && task.dueDate && dateValue(task.dueDate) <= dueSoon) {
      const daysLeft = Math.ceil((dateValue(task.dueDate) - today) / dayMs);
      evidence.push(daysLeft < 0 ? "截止日期已过 " + Math.abs(daysLeft) + " 天，任务仍未开始。" : "截止日期距今 " + daysLeft + " 天，任务仍未开始（预警窗口 " + dueSoonDays + " 天）。");
    }
    if (task.assignee) {
      const memberLoad = loadByAssignee.get(task.assignee.id) ?? [];
      if (memberLoad.length > overloadThreshold) evidence.push(task.assignee.name + " 有 " + memberLoad.length + " 个未完成任务将在未来 " + dueSoonDays + " 天内到期（含已逾期任务），超过并行阈值 " + overloadThreshold + "。");
    }
    const cancelledDependencies = task.dependencies.filter(dependency => dependency.status === "CANCELLED");
    if (cancelledDependencies.length) { evidence.push("前置任务已被取消，请重新评估依赖：" + cancelledDependencies.map(dependency => dependency.title).join("、") + "。"); cancelledDependencies.forEach(dependency => relatedTaskIds.add(dependency.id)); }
    const unfinishedDependencies = task.dependencies.filter((dependency) => !["DONE", "CANCELLED"].includes(dependency.status));
    const conflictingDates = unfinishedDependencies.filter((dependency) => dependency.dueDate && task.plannedStartDate && dependency.dueDate.getTime() >= task.plannedStartDate.getTime());
    if (conflictingDates.length) evidence.push("前置任务计划截止晚于或等于本任务计划开始，请核对排期顺序：" + conflictingDates.map((dependency) => dependency.title).join("、") + "。");
    if (unfinishedDependencies.length) {
      evidence.push("前置任务尚未完成：" + unfinishedDependencies.map((dependency) => dependency.title).join("、") + "。");
      unfinishedDependencies.forEach((dependency) => relatedTaskIds.add(dependency.id));
    }
    if (delayRate !== null && completedWithDueDate.length >= 3 && delayRate >= 0.3 && task.dueDate && dateValue(task.dueDate) <= historyWindow) {
      evidence.push("项目历史延期率为 " + Math.round(delayRate * 100) + "%（" + overdueCount + "/" + completedWithDueDate.length + " 个有截止日期的已完成任务），且该任务在未来 " + historyWindowDays + " 天内到期。");
    }
    if (evidence.length) findings.push({
      taskId: task.id,
      taskTitle: task.title,
      severity: evidence.some((item) => item.includes("截止日期已过") || item.includes("前置任务尚未完成") || item.includes("前置任务已被取消")) ? "HIGH" : "MEDIUM",
      evidence,
      relatedTaskIds: [...relatedTaskIds],
      historicalDelayRate: delayRate,
      historySampleSize: completedWithDueDate.length,
    });
  }
  return findings;
}
