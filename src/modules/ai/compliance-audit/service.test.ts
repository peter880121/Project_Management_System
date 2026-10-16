import { describe, expect, it } from "vitest";
import { findTraceabilityIssues, summarizeCompliance } from "./service";
import type { ComplianceAuditInput } from "./types";

const at = new Date("2026-01-01T00:00:00.000Z");
const data: ComplianceAuditInput = {
  auditLogs: [{ id: "00000000-0000-4000-8000-000000000001", action: "TASK_STATUS_CHANGED", entityType: "Task", entityId: "00000000-0000-4000-8000-000000000004", createdAt: at }],
  tasks: [{ id: "00000000-0000-4000-8000-000000000004", status: "DONE", requirementId: "00000000-0000-4000-8000-000000000002", updatedAt: at, reviewedRequirementVersion: 1 }],
  requirements: [{ id: "00000000-0000-4000-8000-000000000002", updatedAt: at, version: 1, status: "APPROVED" }],
  testCases: [{ id: "00000000-0000-4000-8000-000000000003", requirementId: "00000000-0000-4000-8000-000000000002", status: "FAILED", reviewedRequirementVersion: 1 }],
};

describe("compliance audit summarization", () => {
  it("detects a completed task whose linked test did not pass", () => {
    expect(findTraceabilityIssues(data)).toHaveLength(1);
    expect(findTraceabilityIssues(data)[0]?.recordIds).toContain(data.testCases[0]?.id);
  });

  it("returns deterministic findings and raw audit logs when the model fails", async () => {
    const result = await summarizeCompliance(data, async () => { throw new Error("unavailable"); });
    expect(result.degraded).toBe(true);
    expect(result.auditLogs).toEqual(data.auditLogs);
    expect(result.findings).toHaveLength(1);
  });

  it("rejects model citations to records outside the filtered input", async () => {
    const result = await summarizeCompliance(data, async () => JSON.stringify({ overview: "扫描完成", keyChanges: [], anomalies: [], reviewItems: [{ summary: "异常", auditIds: [], recordIds: ["00000000-0000-4000-8000-000000000099"] }] }));
    expect(result.degraded).toBe(true);
  });
  it("retains rule findings for fabricated audit citations and malformed responses", async () => {
    for (const output of ["invalid-json", JSON.stringify({ overview: "Synthetic", keyChanges: [{ summary: "Unknown event", auditIds: ["00000000-0000-4000-8000-000000000099"] }], anomalies: [], reviewItems: [] })]) {
      const result = await summarizeCompliance(data, async () => output);
      expect(result.degraded).toBe(true); expect(result.findings).toHaveLength(1);
    }
  });
});
