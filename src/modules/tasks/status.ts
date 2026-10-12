import type { TaskStatus } from "@prisma/client";

export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "BLOCKED"],
  IN_PROGRESS: ["TODO", "BLOCKED", "DONE"],
  BLOCKED: ["TODO", "IN_PROGRESS"],
  DONE: ["IN_PROGRESS"],
};

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}
