import type { TaskStatus } from "@prisma/client";

export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "BLOCKED", "CANCELLED"],
  IN_PROGRESS: ["TODO", "BLOCKED", "DONE", "CANCELLED"],
  BLOCKED: ["TODO", "IN_PROGRESS", "CANCELLED"],
  CANCELLED: [],
  DONE: ["IN_PROGRESS", "TODO"],
};

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}

export const EXECUTABLE_TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED"] as const;
