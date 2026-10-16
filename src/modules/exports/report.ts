export const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export type ReportRequirement = { id: string; title: string; version: number; status: string };
export type ReportTask = { id: string; title: string; requirementId: string | null; status: string; reviewedRequirementVersion: number | null };
export type ReportTest = { id: string; title: string; requirementId: string; status: string; reviewedRequirementVersion: number | null };
export function traceabilityCsv(meta: { exportId: string; generatedAt: string }, requirements: ReportRequirement[], tasks: ReportTask[], tests: ReportTest[]) {
  const rows: unknown[][] = [["exportId", "generatedAtUTC", "requirementId", "requirementTitle", "requirementVersion", "requirementStatus", "taskId", "taskTitle", "taskStatus", "taskReviewedVersion", "testCaseId", "testTitle", "testStatus", "testReviewedVersion"]];
  for (const requirement of requirements) {
    const linkedTasks = tasks.filter((task) => task.requirementId === requirement.id); const linkedTests = tests.filter((test) => test.requirementId === requirement.id);
    for (const task of linkedTasks.length ? linkedTasks : [null]) for (const test of linkedTests.length ? linkedTests : [null]) {
      rows.push([meta.exportId, meta.generatedAt, requirement.id, requirement.title, requirement.version, requirement.status, task?.id, task?.title, task?.status, task?.reviewedRequirementVersion, test?.id, test?.title, test?.status, test?.reviewedRequirementVersion]);
      if (rows.length > 20001) throw new Error("EXPORT_ROW_LIMIT");
    }
  }
  for (const task of tasks.filter((row) => !row.requirementId)) rows.push([meta.exportId, meta.generatedAt, "", "", "", "", task.id, task.title, task.status, task.reviewedRequirementVersion, "", "", "", ""]);
  if (rows.length > 20001) throw new Error("EXPORT_ROW_LIMIT");
  return Buffer.from(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`, "utf8");
}
