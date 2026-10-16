import { describe, expect, it } from "vitest";
import { calculateWeeklyLoad, utcWeekStart, wouldCreateCycle, type LoadTask } from "./rules";
import { capacitySchema, scheduleSchema } from "./schemas";
const week = new Date("2026-10-12T00:00:00Z");
const member = { id: "m", name: "Synthetic member" };
const task = (id: string, extra: Partial<LoadTask> = {}): LoadTask => ({ id, title: id, projectId: "p", assigneeId: "m", status: "TODO", plannedStartDate: week, dueDate: new Date("2026-10-18T23:59:59.999Z"), estimateHours: 20, ...extra });
describe("weekly workload and dependency rules", () => {
  it("counts cross-project effort and excludes completed and non-overlapping tasks", () => {
    const [load] = calculateWeeklyLoad([task("a"), task("b", { projectId: "other", estimateHours: 30 }), task("done", { status: "DONE" }), task("later", { plannedStartDate: new Date("2026-10-19"), dueDate: new Date("2026-10-20") })], [member], [{ userId: "m", hours: 40, version: 1 }], week);
    expect(load).toMatchObject({ plannedHours: 50, overloaded: true, taskIds: ["a", "b"], projectIds: ["p", "other"] });
  });
  it("splits effort across calendar weeks without double counting end dates", () => {
    const spanning = task("span", { dueDate: new Date("2026-10-25T23:59:59.999Z"), estimateHours: 70 });
    const first = calculateWeeklyLoad([spanning], [member], [], week)[0];
    const second = calculateWeeklyLoad([spanning], [member], [], new Date("2026-10-19"))[0];
    expect(first.plannedHours).toBe(35); expect(second.plannedHours).toBe(35); expect(first.overloaded).toBeNull();
  });
  it("distinguishes zero capacity, unknown capacity and incomplete effort", () => {
    expect(calculateWeeklyLoad([task("a")], [member], [{ userId: "m", hours: 0, version: 1 }], week)[0].overloaded).toBe(true);
    const [load] = calculateWeeklyLoad([task("a", { estimateHours: null })], [member], [{ userId: "m", hours: 40, version: 1 }], week);
    expect(load.overloaded).toBeNull(); expect(load.incompleteTaskIds).toEqual(["a"]);
    const [overdue] = calculateWeeklyLoad([task("late", { plannedStartDate: new Date("2026-10-01"), dueDate: new Date("2026-10-10") })], [member], [{ userId: "m", hours: 40, version: 1 }], week);
    expect(overdue.overloaded).toBeNull(); expect(overdue.incompleteTaskIds).toEqual(["late"]);
  });
  it("detects indirect cycles and allows replacing old edges", () => {
    const edges = [{ taskId: "b", dependsOnTaskId: "c" }, { taskId: "c", dependsOnTaskId: "a" }];
    expect(wouldCreateCycle("a", ["b"], edges)).toBe(true);
    expect(wouldCreateCycle("a", ["a"], [])).toBe(true);
    expect(wouldCreateCycle("a", [], [...edges, { taskId: "a", dependsOnTaskId: "b" }])).toBe(false);
  });
  it("validates calendar dates, Monday capacity and hour precision", () => {
    const input = { expectedVersion: 0, plannedStartDate: "2026-10-12", dueDate: "2026-10-13", estimateHours: 1.25, dependencyIds: [] };
    expect(scheduleSchema.safeParse(input).success).toBe(true);
    expect(scheduleSchema.safeParse({ ...input, dueDate: "2026-10-11" }).success).toBe(false);
    expect(capacitySchema.safeParse({ weekStart: "2026-10-13", hours: 40, expectedVersion: 0 }).success).toBe(false);
    expect(capacitySchema.safeParse({ weekStart: "2026-10-12", hours: null, expectedVersion: 0 }).success).toBe(true);
    expect(utcWeekStart(new Date("2026-10-18T23:59:59Z")).toISOString()).toBe(week.toISOString());
  });
});
