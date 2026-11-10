import { phaseColorClass, UNGROUPED_PHASE } from "@/modules/projects/task-phases";
export type PlanningTask = { id: string; title: string; planningStatus?: string; phase?: string | null; status: string; assignee: { id: string; name: string } | null; plannedStartDate: string | null; dueDate: string | null; estimateHours: number | null; scheduleVersion: number; dependencyIds: string[] };
export type GanttMode = "Day" | "Week" | "Month";
export function calendarDate(date: Date): string {
  // Frappe uses local calendar components. Converting to UTC here shifts dates in UTC+ zones.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function escapeGanttLabel(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function isPlottableTask(task: PlanningTask): boolean {
  if (task.planningStatus === "UNSCHEDULED") return false;
  if (!task.plannedStartDate || !task.dueDate || task.plannedStartDate > task.dueDate) return false;
  const duration = Date.parse(task.dueDate) - Date.parse(task.plannedStartDate);
  return Number.isFinite(duration) && duration <= 3652 * 86400000;
}
export function scheduledPlanningTasks(tasks: PlanningTask[]) {
  return tasks.filter(isPlottableTask).sort((a, b) => a.plannedStartDate!.localeCompare(b.plannedStartDate!) || a.id.localeCompare(b.id));
}
export function planningTaskLabel(task: PlanningTask) {
  return `${task.status === "CANCELLED" ? "[已取消] " : ""}[${task.phase ?? UNGROUPED_PHASE}] ${task.title}`;
}
export function toGanttTasks(tasks: PlanningTask[]) {
  const scheduled = scheduledPlanningTasks(tasks);
  const ids = new Set(scheduled.map(task => task.id));
  // Frappe passes custom_class to classList.add as ONE token, so never join classes.
  return scheduled.map(task => ({ id: task.id, name: escapeGanttLabel(planningTaskLabel(task)), start: task.plannedStartDate!, end: task.dueDate!, progress: task.status === "DONE" ? 100 : 0, dependencies: task.dependencyIds.filter(id => ids.has(id)), custom_class: task.status === "CANCELLED" ? "is-cancelled" : task.status === "DONE" ? "is-complete" : phaseColorClass(task.phase) }));
}
export function scheduleFromDrag(snapshot: PlanningTask, start: Date, end: Date) {
  return { expectedVersion: snapshot.scheduleVersion, plannedStartDate: calendarDate(start), dueDate: calendarDate(end), estimateHours: snapshot.estimateHours, dependencyIds: [...snapshot.dependencyIds] };
}
