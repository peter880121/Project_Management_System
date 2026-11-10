import { afterEach, describe, expect, it, vi } from "vitest";
import { businessToday, calendarDateTime, completionDateSchema, effortHoursSchema, phaseSchema, taskPlanData, taskPlanSchema } from "./plan";
import { createTaskSchema } from "./create-schema";
import { taskCompletionSchema } from "./signature";
import { analyzeProjectRisks, type RiskTask } from "@/modules/ai/risk/rules";

afterEach(() => vi.useRealTimers());
const plan = { phase: "项目启动", estimateHours: 8, dueDate: "2026-10-19", plannedStartDate: null };
describe("Plan vs Actual calendar and input contracts", () => {
  it.each(["2026-01-31T15:59:59.999Z", "2026-01-31T16:00:00.000Z", "2026-12-31T16:00:00.000Z"])("uses Hong Kong's date at %s", input => {
    const expected = input.includes("12-31") ? "2027-01-01" : input.includes("15:59") ? "2026-01-31" : "2026-02-01";
    expect(businessToday(new Date(input))).toBe(expected);
  });
  it("accepts today and backdated actuals, rejects tomorrow and invalid dates", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T16:01:00.000Z"));
    expect(completionDateSchema.parse("2026-10-19")).toBe("2026-10-19");
    expect(completionDateSchema.parse("2026-10-17")).toBe("2026-10-17");
    for (const date of ["2026-10-20", "2026-02-30", "2026-10-19T00:00:00Z"]) expect(completionDateSchema.safeParse(date).success).toBe(false);
    expect(calendarDateTime("2026-10-19").toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });
  it("enforces positive finite two-decimal effort without coercing blank values", () => {
    for (const value of [0.01, 5.11, 8, 10000]) expect(effortHoursSchema.safeParse(value).success).toBe(true);
    for (const value of [0, -1, NaN, Infinity, 1.234, 10000.01, "8", ""]) expect(effortHoursSchema.safeParse(value).success).toBe(false);
  });
  it("requires complete manual plan inputs and rejects readonly fields", () => {
    const value = { title: "启动会", ...plan };
    expect(createTaskSchema.parse(value).estimateHours).toBe(8);
    for (const field of ["phase", "estimateHours", "dueDate"]) { const invalid = { ...value } as Record<string, unknown>; delete invalid[field]; expect(createTaskSchema.safeParse(invalid).success).toBe(false); }
    for (const field of ["createdAt", "completedAt", "actualHours", "planningStatus", "completionRoundId"]) expect(createTaskSchema.safeParse({ ...value, [field]: "forged" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...value, dueDate: null }).success).toBe(false);
  });
  it("supports custom phases but only one canonical description marker", () => {
    const data = taskPlanData({ ...plan, phase: "  培训复盘  " }, "所属阶段：旧阶段\n任务正文\n所属阶段:重复阶段");
    expect(data.description).toBe("所属阶段：培训复盘\n任务正文");
    expect(data.dueDate?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    for (const phase of ["", "  ", "阶段\n伪造", "x".repeat(51)]) expect(phaseSchema.safeParse(phase).success).toBe(false);
    expect(taskPlanSchema.safeParse({ ...plan, plannedStartDate: "2026-10-20" }).success).toBe(false);
  });
  it("requires actual dates independently of signature and planned dates", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T10:00Z"));
    const value = { status: "DONE", actualHours: 10, completedAt: "2026-10-18", signaturePassword: "synthetic", signatureReason: "确认任务已完成" };
    expect(taskCompletionSchema.safeParse(value).success).toBe(true);
    expect(taskCompletionSchema.safeParse({ ...value, completedAt: undefined }).success).toBe(false);
    expect(taskCompletionSchema.safeParse({ ...value, dueDate: "2026-10-18" }).success).toBe(false);
  });
  it("does not label a task due today overdue, and compares historical date portions", () => {
    const base: RiskTask = { id: "t", title: "task", status: "IN_PROGRESS", completedAt: null, dueDate: new Date("2026-10-19T00:00Z"), assignee: null, dependencies: [] };
    expect(analyzeProjectRisks([base], new Date("2026-10-19T14:00Z"))).toEqual([]);
    expect(analyzeProjectRisks([{ ...base, dueDate: new Date("2026-10-18T23:59:59.999Z") }], new Date("2026-10-19T14:00Z"))[0].evidence[0]).toContain("已过 1 天");
  });
});
