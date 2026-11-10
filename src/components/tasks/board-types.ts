import { STANDARD_PROJECT_TASKS } from "@/modules/projects/templates";
import { taskPhase } from "@/modules/projects/task-phases";
export { taskPhase } from "@/modules/projects/task-phases";
import type { TaskSignature } from "@/modules/tasks/signature";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED" | "CANCELLED";
export type BoardTask = { rowVersion?: number; cancelReason?: string | null; cancelledAt?: string | null; estimateHours?: string | number | null; actualHours?: string | number | null; plannedStartDate?: string | null; dueDate?: string | null; completedAt?: string | null; createdAt?: string; planningStatus?: string; completionRoundId?: string | null; requiresDeliverable?: boolean; deliverables?: { id: string }[]; updatedAt?: string; id: string; title: string; description: string | null; status: TaskStatus; assigneeId: string | null; assignee: { id: string; name: string } | null; requirement: { id: string; title: string } | null; dependencies?: { dependsOn: { id: string; title: string; status: TaskStatus } }[] };
export type TaskDetail = Omit<BoardTask, "requirement"> & { scheduleVersion?: number; estimateHours: string | null; actualHours: string | null; requirement: { id: string; title: string; content: string; testCases: { id: string; title: string; status: string }[] } | null; audits: { id: string; action: string; createdAt: string; actor: { name: string }; before: unknown; after: unknown }[] };
export type UserOption = { id: string; name: string; email: string };
export type TaskCompletion = { expectedRowVersion?: number; status: "DONE"; actualHours: number; completedAt: string; expectedCompletionRoundId?: string | null } & TaskSignature;
export type TaskChange = ({ status: "CANCELLED"; cancelReason: string; expectedRowVersion: number } | { status: Exclude<TaskStatus, "DONE" | "CANCELLED"> } | TaskCompletion | { assigneeId: string | null } | { requiresDeliverable: boolean; expectedUpdatedAt: string }) & { expectedRowVersion?: number };
export const taskColumns: { status: TaskStatus; title: string; dot: string }[] = [{ status: "TODO", title: "待办", dot: "bg-slate-400" }, { status: "IN_PROGRESS", title: "进行中", dot: "bg-sky-500" }, { status: "BLOCKED", title: "受阻", dot: "bg-amber-500" }, { status: "DONE", title: "已完成", dot: "bg-emerald-500" }];
export function taskStatusOptions(status: TaskStatus, role: string): TaskStatus[] {
  if (status === "CANCELLED") return [];
  if (status === "TODO") return ["IN_PROGRESS", "BLOCKED"];
  if (status === "IN_PROGRESS") return ["TODO", "BLOCKED", "DONE"];
  if (status === "BLOCKED") return ["TODO", "IN_PROGRESS"];
  return ["PM", "ADMIN"].includes(role) ? ["IN_PROGRESS", "TODO"] : [];
}
export function canUpdateTask(task: BoardTask, role: string, userId: string) {
  return task.status !== "CANCELLED" && (["PM", "ADMIN"].includes(role) || (role === "MEMBER" && task.assigneeId === userId));
}
export function orderBoardTasks(tasks: BoardTask[]): BoardTask[] {
  const rank = (task: BoardTask) => {
    const index = STANDARD_PROJECT_TASKS.findIndex(template => template.title === task.title && template.phase === taskPhase(task.description));
    return index < 0 ? STANDARD_PROJECT_TASKS.length : index;
  };
  return [...tasks].sort((a, b) => rank(a) - rank(b));
}
