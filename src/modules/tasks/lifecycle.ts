import { BusinessError } from "@/modules/audit/errors";
export { taskCancelSchema } from "./lifecycle-schema";
export class TaskCancelledError extends BusinessError { readonly code = "TASK_CANCELLED"; }
export function assertTaskWritable(task: { status: string }) {
  if (task.status === "CANCELLED") throw new TaskCancelledError("任务已取消，禁止修改、分配或签署", 409);
}
export function assertTaskVersion(task: { rowVersion?: number }, expected?: number, required = false) {
  if (required && expected === undefined || expected !== undefined && expected !== (task.rowVersion ?? 1)) throw new BusinessError("任务版本已变化，请刷新后重试", 409);
}
