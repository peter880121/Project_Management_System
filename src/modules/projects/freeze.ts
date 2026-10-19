export const ARCHIVED_MESSAGE = "项目已归档，禁止修改";
export class ProjectFrozenError extends Error {
  constructor(readonly archived = true) { super(archived ? ARCHIVED_MESSAGE : "项目正在验收，业务资料已锁定；请先撤回或驳回验收"); }
}
export function freezeErrorResponse(error: unknown): Response | null {
  const marker = error instanceof Error ? error.message + JSON.stringify("meta" in error ? error.meta : null) : "";
  if (error instanceof ProjectFrozenError || marker.includes("ER_ARCHIVED_PROJECT")) {
    const archived = !(error instanceof ProjectFrozenError) || error.archived;
    return Response.json({ code: archived ? "PROJECT_ARCHIVED" : "PROJECT_IN_ACCEPTANCE", error: archived ? ARCHIVED_MESSAGE : error.message }, { status: archived ? 403 : 409 });
  }
  if (marker.includes("ER_ACCEPTANCE_IMMUTABLE")) return Response.json({ code: "ACCEPTANCE_IMMUTABLE", error: "验收证据不可修改或删除" }, { status: 409 });
  return null;
}
