import { describe, expect, it } from "vitest";
import { findTraceabilityIssues } from "./rules";
import { summarizeCompliance } from "./service";
import type { ComplianceAuditInput } from "./types";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function complete(): ComplianceAuditInput {
  return { auditLogs: [{ id: id(4), entityId: id(2), entityType: "Task", action: "TASK_CREATED", createdAt: new Date() }], requirements: [{ id: id(1), version: 2, status: "APPROVED", updatedAt: new Date() }], tasks: [{ id: id(2), requirementId: id(1), reviewedRequirementVersion: 2, status: "DONE", updatedAt: new Date() }], testCases: [{ id: id(3), requirementId: id(1), reviewedRequirementVersion: 2, status: "PASSED" }] };
}
describe("deterministic compliance rules", () => {
  it("does not flag a complete, reviewed chain", () => expect(findTraceabilityIssues(complete())).toEqual([]));
  it("detects all six gap types and marks missing audit provenance", () => {
    const data = complete();
    data.tasks[0]!.reviewedRequirementVersion = 1;
    data.testCases[0]!.reviewedRequirementVersion = null; data.testCases[0]!.status = "FAILED";
    data.tasks.push({ ...data.tasks[0]!, id: id(5), requirementId: null });
    data.requirements.push({ ...data.requirements[0]!, id: id(6) });
    const findings = findTraceabilityIssues(data);
    expect(new Set(findings.map((row) => row.code))).toEqual(new Set(["TASK_WITHOUT_REQUIREMENT", "APPROVED_REQUIREMENT_WITHOUT_TASK", "REQUIREMENT_WITHOUT_TEST", "DONE_TASK_WITH_UNPASSED_TEST", "TASK_REQUIREMENT_REVIEW_STALE", "TEST_REQUIREMENT_REVIEW_STALE"]));
    expect(findings.find((row) => row.code === "TASK_WITHOUT_REQUIREMENT")?.sourceAuditMissing).toBe(true);
    expect(findings.find((row) => row.code === "DONE_TASK_WITH_UNPASSED_TEST")?.auditIds).toEqual([id(4)]);
  });
  it("does not treat newer timestamps or a passed test as version review", () => {
    const data = complete(); data.tasks[0]!.updatedAt = new Date("2099-01-01"); data.tasks[0]!.reviewedRequirementVersion = null; data.testCases[0]!.reviewedRequirementVersion = 1;
    expect(findTraceabilityIssues(data).map((row) => row.code)).toEqual(["TASK_REQUIREMENT_REVIEW_STALE", "TEST_REQUIREMENT_REVIEW_STALE"]);
  });
  it("does not require retired requirements to acquire new tasks or tests", () => {
    const data = complete(); data.tasks = []; data.testCases = []; data.requirements[0]!.status = "RETIRED";
    expect(findTraceabilityIssues(data)).toEqual([]);
  });
  it("retains findings when a valid model response omits every anomaly", async () => {
    const data = complete(); data.tasks[0]!.requirementId = null;
    const result = await summarizeCompliance(data, async () => JSON.stringify({ overview: "Synthetic summary", keyChanges: [], anomalies: [], reviewItems: [] }));
    expect(result.degraded).toBe(false); expect(result.findings.some((row) => row.code === "TASK_WITHOUT_REQUIREMENT")).toBe(true);
  });
});
