/** Shared by HTTP, transactions, capabilities and worker candidate queries. */
export const FROZEN_PROJECT_STATUSES = ["ARCHIVED", "ON_HOLD", "CANCELLED"] as const;
export const ARCHIVED_MESSAGE = "项目已归档，禁止修改";
export class ProjectFrozenError extends Error {
  readonly archived: boolean;
  readonly projectStatus: string;
  constructor(status: string | boolean = "ARCHIVED") {
    const value = typeof status === "boolean" ? status ? "ARCHIVED" : "PENDING_ACCEPTANCE" : status;
    super(value === "ARCHIVED" ? ARCHIVED_MESSAGE : value === "ON_HOLD" ? "项目已暂停，禁止修改；请先恢复项目" : value === "CANCELLED" ? "项目已取消，禁止修改" : "项目正在验收，业务资料已锁定；请先撤回或驳回验收");
    this.projectStatus = value; this.archived = value === "ARCHIVED";
  }
}
export function assertProjectStatusWritable(status: string | undefined, worker = false) {
  if (FROZEN_PROJECT_STATUSES.some(value => value === status) || !worker && status === "PENDING_ACCEPTANCE") throw new ProjectFrozenError(status);
}
export function projectFreezeDetails(error: unknown) {
  const marker = error instanceof Error ? error.message + JSON.stringify("meta" in error ? error.meta : null) : "";
  const status = error instanceof ProjectFrozenError ? error.projectStatus : marker.includes("ER_PROJECT_FROZEN:ON_HOLD") ? "ON_HOLD" : marker.includes("ER_PROJECT_FROZEN:CANCELLED") ? "CANCELLED" : marker.includes("ER_ARCHIVED_PROJECT") ? "ARCHIVED" : null;
  if (!status) return null;
  const frozen = new ProjectFrozenError(status);
  return { code: status === "ARCHIVED" ? "PROJECT_ARCHIVED" : status === "PENDING_ACCEPTANCE" ? "PROJECT_IN_ACCEPTANCE" : "PROJECT_FROZEN", projectStatus: status, error: frozen.message, status: status === "PENDING_ACCEPTANCE" ? 409 : 403 };
}
export function freezeErrorResponse(error: unknown): Response | null {
  const details = projectFreezeDetails(error);
  if (details) {
    const { status, projectStatus, ...body } = details;
    return Response.json({ ...body, ...(["ON_HOLD", "CANCELLED"].includes(projectStatus) ? { projectStatus } : {}) }, { status });
  }
  const marker = error instanceof Error ? error.message + JSON.stringify("meta" in error ? error.meta : null) : "";
  if (marker.includes("ER_REQUIREMENT_EVIDENCE_IMMUTABLE")) return Response.json({ error: "需求版本与审批、验证证据不可修改或删除" }, { status: 409 });
  if (marker.includes("ER_REQUIREMENT_ATTACHMENT_LOCKED")) return Response.json({ error: "需求已提交评审或诉求已处理，图片附件已锁定" }, { status: 409 });
  if (marker.includes("ER_REQUIREMENT_SCOPE")) return Response.json({ error: "需求关联记录不属于当前项目" }, { status: 400 });
  if (marker.includes("ER_TASK_CANCELLED") || error instanceof Error && "code" in error && error.code === "TASK_CANCELLED") return Response.json({ code: "TASK_CANCELLED", error: "任务已取消，禁止修改、分配或签署" }, { status: 409 });
  if (marker.includes("ER_TASK_REOPEN_CLEANUP")) return Response.json({ error: "任务重开必须清空全部实际数据和签名轮次" }, { status: 409 });
  if (marker.includes("ER_TASK_CANCEL_REASON")) return Response.json({ error: "任务取消必须填写原因并记录操作者" }, { status: 400 });
  if (marker.includes("ER_STATUS_CHANGE_REQUIRED")) return Response.json({ error: "项目状态变更必须填写说明并通过专用流程操作" }, { status: 409 });
  if (marker.includes("ER_STATUS_CHANGE_IMMUTABLE") || marker.includes("ER_ACCEPTANCE_IMMUTABLE")) return Response.json({ code: "ACCEPTANCE_IMMUTABLE", error: "状态变更记录和验收证据不可修改或删除" }, { status: 409 });
  return null;
}
