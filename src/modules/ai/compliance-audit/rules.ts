import type { ComplianceAuditInput, ComplianceFinding } from "./types";

export const RULE_VERSION = "2";
export function findTraceabilityIssues(data: ComplianceAuditInput): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  const requirements = new Map(data.requirements.map((row) => [row.id, row]));
  function add(code: string, id: string, summary: string, recordIds: string[], version: number | null = null) {
    const ids = [...new Set(recordIds)].slice(0, 30);
    const auditIds = [...new Set(data.auditLogs.filter((log) => ids.includes(log.entityId)).map((log) => log.id))].slice(0, 20);
    findings.push({ findingKey: `${code}:${id}:${version ?? 0}`, code, summary: recordIds.length > 30 ? `${summary} 关联证据较多，仅展示前 30 项，请补查。` : summary, recordIds: ids, auditIds, requirementVersion: version, sourceAuditMissing: auditIds.length === 0 });
  }
  for (const task of data.tasks) {
    const requirement = task.requirementId ? requirements.get(task.requirementId) : undefined;
    if (!task.requirementId) {
      add("TASK_WITHOUT_REQUIREMENT", task.id, "任务未关联需求。", [task.id]);
      continue;
    }
    if (!requirement) continue; // Incomplete coverage is explicitly reported by the snapshot loader.
    if (task.reviewedRequirementVersion !== requirement.version) add("TASK_REQUIREMENT_REVIEW_STALE", task.id, "任务尚未复核当前需求版本。", [task.id, requirement.id], requirement.version);
    const failed = data.testCases.filter((row) => row.requirementId === requirement.id && row.status !== "PASSED");
    if (task.status === "DONE" && failed.length) add("DONE_TASK_WITH_UNPASSED_TEST", task.id, "已完成任务关联需求仍有未通过测试。", [task.id, requirement.id, ...failed.map((row) => row.id)], requirement.version);
  }
  for (const requirement of data.requirements) {
    if (requirement.status === "RETIRED") continue;
    if (requirement.status === "APPROVED" && !data.tasks.some((row) => row.requirementId === requirement.id)) add("APPROVED_REQUIREMENT_WITHOUT_TASK", requirement.id, "已批准需求没有关联任务。", [requirement.id], requirement.version);
    if (!data.testCases.some((row) => row.requirementId === requirement.id)) add("REQUIREMENT_WITHOUT_TEST", requirement.id, "需求尚无测试用例。", [requirement.id], requirement.version);
  }
  for (const testCase of data.testCases) {
    const requirement = requirements.get(testCase.requirementId);
    if (requirement && testCase.reviewedRequirementVersion !== requirement.version) add("TEST_REQUIREMENT_REVIEW_STALE", testCase.id, "测试用例尚未复核当前需求版本。", [testCase.id, requirement.id], requirement.version);
  }
  return findings;
}
