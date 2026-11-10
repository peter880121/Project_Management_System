import type { TaskStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { canTransitionTaskStatus } from "./status";

// Keep expectations independent of the production transition table.
const expectedTransitions = {
  TODO: { TODO: false, IN_PROGRESS: true, BLOCKED: true, DONE: false, CANCELLED: true },
  IN_PROGRESS: { TODO: true, IN_PROGRESS: false, BLOCKED: true, DONE: true, CANCELLED: true },
  BLOCKED: { TODO: true, IN_PROGRESS: true, BLOCKED: false, DONE: false, CANCELLED: true },
  DONE: { TODO: true, IN_PROGRESS: true, BLOCKED: false, DONE: false, CANCELLED: false },
  CANCELLED: { TODO: false, IN_PROGRESS: false, BLOCKED: false, DONE: false, CANCELLED: false },
} satisfies Record<TaskStatus, Record<TaskStatus, boolean>>;

const statuses = Object.keys(expectedTransitions) as TaskStatus[];
const transitionCases = statuses.flatMap((from) =>
  statuses.map((to) => ({ from, to, expected: expectedTransitions[from][to] })),
);

describe("task status transitions", () => {
  it.each(transitionCases)("$from -> $to returns $expected", ({ from, to, expected }) => {
    expect(canTransitionTaskStatus(from, to)).toBe(expected);
  });

  it("allows the expected forward, blocked, and reopen paths", () => {
    expect(canTransitionTaskStatus("TODO", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTaskStatus("IN_PROGRESS", "BLOCKED")).toBe(true);
    expect(canTransitionTaskStatus("BLOCKED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTaskStatus("DONE", "IN_PROGRESS")).toBe(true);
  });

  it("rejects skipping work or transitions that do not change state", () => {
    expect(canTransitionTaskStatus("TODO", "DONE")).toBe(false);
    expect(canTransitionTaskStatus("DONE", "BLOCKED")).toBe(false);
    expect(canTransitionTaskStatus("TODO", "TODO")).toBe(false);
  });
});
