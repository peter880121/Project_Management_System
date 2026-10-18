import { expect, it } from "vitest";
import { calendarDate, isPlottableTask, scheduleFromDrag, toGanttTasks, type PlanningTask } from "./gantt-adapter";
const task: PlanningTask = { id: "task", title: "Synthetic <img src=x onerror=alert(1)>", status: "TODO", assignee: null, plannedStartDate: "2026-10-19", dueDate: "2026-10-19", estimateHours: 4, scheduleVersion: 7, dependencyIds: ["missing"] };
it("preserves local calendar dates and same-day inclusive deadlines", () => {
  const start = new Date(2026, 9, 19, 0, 0, 0);
  const end = new Date(2026, 9, 19, 23, 59, 59);
  expect(calendarDate(start)).toBe("2026-10-19");
  expect(scheduleFromDrag(task, start, end)).toEqual({ expectedVersion: 7, plannedStartDate: "2026-10-19", dueDate: "2026-10-19", estimateHours: 4, dependencyIds: ["missing"] });
});
it("escapes native innerHTML labels and excludes undated tasks and dangling arrows", () => {
  const converted = toGanttTasks([task, { ...task, id: "missing", plannedStartDate: null }]);
  expect(converted).toHaveLength(1);
  expect(converted[0].name).toContain("&lt;img");
  expect(converted[0].dependencies).toEqual([]);
  expect(converted[0].end).toBe("2026-10-19");
  expect(isPlottableTask({ ...task, dueDate: "2040-01-01" })).toBe(false);
});
it("takes a versioned immutable dependency snapshot for a drag", () => {
  const copy = { ...task, dependencyIds: [...task.dependencyIds] };
  const body = scheduleFromDrag(copy, new Date(2026, 9, 20), new Date(2026, 9, 22));
  copy.dependencyIds.push("another"); copy.scheduleVersion++;
  expect(body.expectedVersion).toBe(7); expect(body.dependencyIds).toEqual(["missing"]);
});
it("adds phase labels and colors without adding rows or rewriting task identity and dependencies", () => {
  const rows = toGanttTasks([{ ...task, phase: "需求与蓝图", dependencyIds: ["source"] }, { ...task, id: "source", phase: "项目启动" }]);
  expect(rows).toHaveLength(2);
  const target = rows.find(row => row.id === task.id)!;
  expect(target.name).toContain("[需求与蓝图]");
  expect(target.custom_class).toBe("phase-1");
  expect(target.dependencies).toEqual(["source"]);
  expect(toGanttTasks([{ ...task, status: "DONE", phase: "需求与蓝图" }])[0].custom_class).toBe("is-complete");
});
