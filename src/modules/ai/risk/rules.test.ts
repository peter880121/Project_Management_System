import { describe, expect, it } from "vitest";
import { analyzeProjectRisks, type RiskTask } from "./rules";

const now = new Date("2026-10-12T00:00:00.000Z");
const task = (id: string, extra: Partial<RiskTask> = {}): RiskTask => ({ id, title: "Synthetic task " + id, status: "IN_PROGRESS", dueDate: new Date("2026-10-20T00:00:00.000Z"), completedAt: null, assignee: null, dependencies: [], ...extra });

describe("risk rules", () => {
  it("flags a near deadline when work has not started", () => {
    const result = analyzeProjectRisks([task("near", { status: "TODO", dueDate: new Date("2026-10-15T00:00:00.000Z") })], now);
    expect(result[0]?.evidence.join(" ")).toContain("任务仍未开始");
  });

  it("flags a member with more parallel work than the threshold", () => {
    const member = { id: "member-1", name: "Synthetic member" };
    const tasks = ["a", "b", "c", "d"].map((id) => task(id, { assignee: member, dueDate: new Date("2026-10-17T00:00:00.000Z") }));
    const result = analyzeProjectRisks(tasks, now, { overloadThreshold: 3 });
    expect(result).toHaveLength(4);
    expect(result[0]?.evidence.join(" ")).toContain("4 个未完成任务将在未来");
  });

  it("flags unfinished prerequisites and cites their task IDs", () => {
    const blockedBy = { id: "pre-1", title: "Synthetic prerequisite", status: "IN_PROGRESS" as const };
    const result = analyzeProjectRisks([task("dependent", { dependencies: [blockedBy] })], now);
    expect(result[0]?.relatedTaskIds).toEqual(["pre-1"]);
    expect(result[0]?.severity).toBe("HIGH");
  });

  it("adds historical delay evidence only when enough completed history exists", () => {
    const history = [task("late-1", { status: "DONE", dueDate: new Date("2026-10-01T00:00:00.000Z"), completedAt: new Date("2026-10-03T00:00:00.000Z") }), task("late-2", { status: "DONE", dueDate: new Date("2026-10-02T00:00:00.000Z"), completedAt: new Date("2026-10-04T00:00:00.000Z") }), task("on-time", { status: "DONE", dueDate: new Date("2026-10-03T00:00:00.000Z"), completedAt: new Date("2026-10-03T00:00:00.000Z") })];
    const result = analyzeProjectRisks([...history, task("upcoming", { dueDate: new Date("2026-10-20T00:00:00.000Z") })], now);
    expect(result.find((item) => item.taskId === "upcoming")?.historicalDelayRate).toBeCloseTo(2 / 3);
    expect(result.find((item) => item.taskId === "upcoming")?.evidence.join(" ")).toContain("历史延期率为 67%");
  });

  it("does not mutate task statuses", () => {
    const original = task("keep");
    analyzeProjectRisks([original], now);
    expect(original.status).toBe("IN_PROGRESS");
  });
});
