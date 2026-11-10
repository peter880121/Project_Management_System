import { describe, it, expect } from "vitest";
import { taskCancelSchema } from "./lifecycle-schema";
import { assertTaskVersion, assertTaskWritable } from "./lifecycle";
import { canTransitionTaskStatus } from "./status";
import { canUpdateTask, taskStatusOptions, type BoardTask } from "@/components/tasks/board-types";
import { calculateWeeklyLoad } from "@/modules/planning/rules";
import { analyzeProjectRisks } from "@/modules/ai/risk/rules";
import { toGanttTasks } from "@/modules/planning/gantt-adapter";
describe("task terminal state and execution statistics", () => {
  it("cancel is a terminal state and DONE requires explicit reopening", () => {
    for (const state of ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const) expect(canTransitionTaskStatus("CANCELLED", state)).toBe(false);
    expect(canTransitionTaskStatus("DONE", "CANCELLED")).toBe(false); expect(canTransitionTaskStatus("BLOCKED", "CANCELLED")).toBe(true);
  });
  it("requires a trimmed 10-1000 character reason and an observed task version", () => {
    const body = { status: "CANCELLED", expectedRowVersion: 1, cancelReason: "客户需求范围正式变更，此任务取消。" };
    expect(taskCancelSchema.safeParse(body).success).toBe(true);
    for (const cancelReason of ["", " ".repeat(30), "短原因", "字".repeat(1001)]) expect(taskCancelSchema.safeParse({ ...body, cancelReason }).success).toBe(false);
    expect(taskCancelSchema.safeParse({ ...body, signaturePassword: "never accept cancellation credentials" }).success).toBe(false);
  });
  it("rejects stale versions and locks cancelled task editing for every role", () => {
    expect(() => assertTaskVersion({ rowVersion: 2 }, 1)).toThrow(); expect(() => assertTaskVersion({ rowVersion: 2 }, undefined, true)).toThrow();
    expect(() => assertTaskWritable({ status: "CANCELLED" })).toThrow("任务已取消");
    for (const role of ["PM", "ADMIN", "MEMBER", "QA"]) { expect(taskStatusOptions("CANCELLED", role)).toEqual([]); expect(canUpdateTask({ status: "CANCELLED", assigneeId: "member" } as BoardTask, role, "member")).toBe(false); }
  });
  it("preserves a cancelled Gantt bar with a grey presentation class", () => {
    expect(toGanttTasks([{ id: "cancelled", title: "Cancelled", status: "CANCELLED", assignee: null, plannedStartDate: "2026-10-19", dueDate: "2026-10-20", estimateHours: 2, scheduleVersion: 0, dependencyIds: [] }])[0].custom_class).toBe("is-cancelled");
  });
  it("excludes cancelled tasks from weekly load and overdue risk while preserving dependency warnings", () => {
    const row = { id: "cancelled", title: "Cancelled", projectId: "project", assigneeId: "member", assignee: { id: "member", name: "Synthetic member" }, status: "CANCELLED" as const, completedAt: null, plannedStartDate: new Date("2026-10-12T00:00:00Z"), dueDate: new Date("2026-10-13T00:00:00Z"), estimateHours: 100, dependencies: [] };
    expect(calculateWeeklyLoad([row], [{ id: "member", name: "Synthetic member" }], [], new Date("2026-10-12T00:00:00Z"))[0]).toMatchObject({ plannedHours: 0, taskIds: [], incompleteTaskIds: [] });
    expect(analyzeProjectRisks([row], new Date("2026-10-20T00:00:00Z"))).toEqual([]);
    const risks = analyzeProjectRisks([{ ...row, id: "dependent", status: "TODO", dependencies: [{ id: row.id, title: row.title, status: "CANCELLED" }] }], new Date("2026-10-20T00:00:00Z"));
    expect(risks[0].relatedTaskIds).toContain(row.id);
  });
});
