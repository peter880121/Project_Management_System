import { describe, expect, it } from "vitest";
import { issueCommandSchema, type IssueCommand } from "./issue-schema";
import { issueTransition } from "./issue-transition";
const command = (action: IssueCommand["action"]): IssueCommand => ({
  action,
  expectedRowVersion: 1,
  note: "Synthetic review",
  evidenceIds: [],
});
describe("audit remediation guardrails", () => {
  it("allows the explicit lifecycle and QA return/reopen paths", () => {
    expect(issueTransition("PENDING", command("CONFIRM"), "QA", false)).toBe(
      "OPEN",
    );
    expect(issueTransition("OPEN", command("ASSIGN"), "PM", false)).toBe(
      "REMEDIATING",
    );
    expect(
      issueTransition("REMEDIATING", command("SUBMIT"), "MEMBER", true),
    ).toBe("VERIFYING");
    expect(issueTransition("VERIFYING", command("RETURN"), "QA", false)).toBe(
      "REMEDIATING",
    );
    expect(issueTransition("VERIFYING", command("CLOSE"), "QA", false)).toBe(
      "CLOSED",
    );
    expect(issueTransition("CLOSED", command("REOPEN"), "QA", false)).toBe(
      "OPEN",
    );
  });
  it.each(["ADMIN", "PM", "MEMBER"])(
    "prevents %s from formal QA decisions",
    (role) => {
      for (const action of [
        "CONFIRM",
        "DISMISS",
        "CLOSE",
        "RETURN",
        "REOPEN",
      ] as const)
        expect(() =>
          issueTransition("PENDING", command(action), role, false),
        ).toThrow("无权");
    },
  );
  it("rejects shortcuts and submissions by someone other than the assignee", () => {
    expect(() =>
      issueTransition("OPEN", command("CLOSE"), "QA", false),
    ).toThrow("状态");
    expect(() =>
      issueTransition("REMEDIATING", command("SUBMIT"), "MEMBER", false),
    ).toThrow("无权");
  });
  it("requires explanation, concurrency token, assignment fields and submission evidence", () => {
    expect(
      issueCommandSchema.safeParse({ ...command("CONFIRM"), note: " " })
        .success,
    ).toBe(false);
    expect(
      issueCommandSchema.safeParse({
        ...command("CONFIRM"),
        expectedRowVersion: 0,
      }).success,
    ).toBe(false);
    expect(issueCommandSchema.safeParse(command("ASSIGN")).success).toBe(false);
    expect(issueCommandSchema.safeParse(command("SUBMIT")).success).toBe(false);
  });
});
