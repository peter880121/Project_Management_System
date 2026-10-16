import { describe, expect, it } from "vitest";
import { scheduleFormInput, scheduleValidationMessage } from "./form-input";

describe("per-task schedule form input", () => {
  it("serializes only the selected form and supports unknown hours", () => {
    const first = new FormData(); first.set("start", "2026-10-16"); first.set("due", "2026-10-23"); first.set("hours", "8");
    const second = new FormData(); second.set("start", "2026-10-16"); second.set("due", "2026-10-21"); second.set("hours", "");
    expect(scheduleFormInput(first, 2)).toMatchObject({ expectedVersion: 2, estimateHours: 8 });
    const input = scheduleFormInput(second, 0);
    expect(input).toEqual({ expectedVersion: 0, plannedStartDate: "2026-10-16", dueDate: "2026-10-21", estimateHours: null, dependencyIds: [] });
    expect(scheduleValidationMessage(input)).toBeNull();
  });
  it("explains invalid dates, hour precision and stale version formats", () => {
    const input = { expectedVersion: 0, plannedStartDate: "2026-10-16", dueDate: "2026-10-21", estimateHours: 8, dependencyIds: [] };
    expect(scheduleValidationMessage({ ...input, dueDate: "2026-02-30" })).toContain("截止日期");
    expect(scheduleValidationMessage({ ...input, estimateHours: 0 })).toContain("预计工时");
    expect(scheduleValidationMessage({ ...input, estimateHours: 1.001 })).toContain("两位小数");
    expect(scheduleValidationMessage({ ...input, expectedVersion: null })).toContain("排期版本");
    expect(scheduleValidationMessage({ ...input, dueDate: "2026-10-15" })).toContain("开始日期不能晚于");
  });
});
