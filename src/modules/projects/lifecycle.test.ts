import { describe, it, expect } from "vitest";
import { lifecycleSchema, cancelProjectSchema, resumeStatus } from "./lifecycle";
import { assertProjectStatusWritable, freezeErrorResponse, ProjectFrozenError } from "./freeze";
import { projectCapabilities } from "./capabilities";
import { requestChangesBusiness } from "./write-scope";
import { safeStreamError } from "@/modules/ai/streaming/response";
const base = { reason: "客户预算暂缓，等待资源重新配置后恢复。", requestKey: "a5555555-5555-4555-8555-555555555555", expectedRowVersion: 1 };
describe("project pause/cancel invariants", () => {
  it("requires meaningful bounded explanation and rejects caller-selected states", () => {
    for (const reason of ["", " ".repeat(30), "短说明", "字".repeat(1001)]) expect(lifecycleSchema.safeParse({ ...base, reason }).success).toBe(false);
    expect(lifecycleSchema.safeParse({ ...base, status: "ACTIVE" }).success).toBe(false);
    expect(lifecycleSchema.parse({ ...base, reason: ` ${base.reason} ` }).reason).toBe(base.reason);
    expect(cancelProjectSchema.safeParse(base).success).toBe(false);
  });
  it.each([null, "", "CANCELLED", "ARCHIVED", "corrupted", "ACTIVE", "planning", "PLANNING "])("defaults invalid/absent pause origin %s to ACTIVE", value => expect(resumeStatus(value)).toBe("ACTIVE"));
  it("restores a valid PLANNING origin precisely", () => expect(resumeStatus("PLANNING")).toBe("PLANNING"));
  it.each(["ON_HOLD", "CANCELLED"])("reuses HTTP/transaction/SSE freeze response for %s, including worker writes", async status => {
    for (const worker of [false, true]) expect(() => assertProjectStatusWritable(status, worker)).toThrow(ProjectFrozenError);
    for (const error of [new ProjectFrozenError(status), Object.assign(new Error("query failed"), { meta: { message: `ER_PROJECT_FROZEN:${status}` } })]) {
      const response = freezeErrorResponse(error)!; expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: "PROJECT_FROZEN", projectStatus: status });
      expect(safeStreamError(error)).toMatchObject({ event: "error", data: { code: "PROJECT_FROZEN", status: 403, retryable: false } });
    }
  });
  it.each(["PM", "ADMIN", "QA", "MEMBER"] as const)("disables every cancelled editing capability for %s", role => {
    const caps = projectCapabilities({ status: "CANCELLED", rowVersion: 2, ownerId: "pm", archivedAt: null }, { id: "pm", role });
    expect(caps.writable).toBe(false); for (const [key, value] of Object.entries(caps)) if (key.startsWith("can")) expect(value).toBe(false);
    const paused = projectCapabilities({ status: "ON_HOLD", rowVersion: 2, ownerId: "pm", archivedAt: null }, { id: "pm", role });
    for (const key of ["canActivate", "canEditTasks", "canSchedule", "canUploadDeliverables", "canApproveDeliverables", "canCreateMeeting", "canManageMembers"] as const) expect(paused[key]).toBe(false);
    expect(paused.canResume).toBe(["ADMIN", "PM"].includes(role));
  });
  it("only exempts dedicated lifecycle/read routes, never ordinary business mutations", () => {
    for (const action of ["pause", "resume", "cancel"]) expect(requestChangesBusiness(new Request(`http://localhost/api/projects/id/${action}`, { method: "POST" }))).toBe(false);
    for (const action of ["tasks", "meetings", "deliverables", "members"]) expect(requestChangesBusiness(new Request(`http://localhost/api/projects/id/${action}`, { method: "POST" }))).toBe(true);
  });
});
