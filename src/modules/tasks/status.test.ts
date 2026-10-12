import { describe, expect, it } from "vitest";
import { canTransitionTaskStatus } from "./status";

describe("task status transitions", () => {
  it("allows the expected forward, blocked, and reopen paths", () => {
    expect(canTransitionTaskStatus("TODO", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTaskStatus("IN_PROGRESS", "BLOCKED")).toBe(true);
    expect(canTransitionTaskStatus("BLOCKED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTaskStatus("DONE", "IN_PROGRESS")).toBe(true);
  });

  it("rejects skipping work or transitions that do not change state", () => {
    expect(canTransitionTaskStatus("TODO", "DONE")).toBe(false);
    expect(canTransitionTaskStatus("DONE", "TODO")).toBe(false);
    expect(canTransitionTaskStatus("TODO", "TODO")).toBe(false);
  });
});
