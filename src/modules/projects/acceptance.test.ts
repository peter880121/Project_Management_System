import { expect, it } from "vitest";
import { canonicalJson, snapshotHash } from "./acceptance";
import { closureHtml } from "./closure-report";
import { projectCapabilities } from "./capabilities";
import { freezeErrorResponse, ProjectFrozenError } from "./freeze";
it("canonicalizes MySQL JSON key order and detects evidence changes", () => {
  const first = { tasks: [{ id: "task", status: "DONE", actualHours: "2" }], signatureAuditIds: ["audit"], deliverables: [] };
  const reordered = { deliverables: [], signatureAuditIds: ["audit"], tasks: [{ actualHours: "2", status: "DONE", id: "task" }] };
  expect(canonicalJson(first)).toBe(canonicalJson(reordered)); expect(snapshotHash(first)).toBe(snapshotHash(reordered));
  expect(snapshotHash(first)).not.toBe(snapshotHash({ ...first, tasks: [{ ...first.tasks[0], actualHours: "3" }] }));
});
it("maps both service and native MySQL trigger failures to the same friendly 403", async () => {
  for (const error of [new ProjectFrozenError(), Object.assign(new Error("Raw query failed"), { meta: { database_error: "1644: ER_ARCHIVED_PROJECT" } })]) {
    const response = freezeErrorResponse(error)!; expect(response.status).toBe(403); expect(await response.json()).toEqual({ code: "PROJECT_ARCHIVED", error: "项目已归档，禁止修改" });
  }
  expect(freezeErrorResponse(new Error("unrelated secret"))).toBeNull(); expect(freezeErrorResponse(new ProjectFrozenError(false))?.status).toBe(409);
});
it("removes all editing capabilities after archive and separates QA/ADMIN duties", () => {
  const project = { status: "ARCHIVED", rowVersion: 4, ownerId: "pm", archivedAt: new Date(), currentAcceptance: { state: "ARCHIVED", submittedById: "pm", qaApprovedById: "qa" } };
  const caps = projectCapabilities(project, { id: "admin", role: "ADMIN" });
  expect(caps.writable).toBe(false); for (const [key, value] of Object.entries(caps)) if (key.startsWith("can")) expect(value).toBe(false);
  expect(projectCapabilities({ ...project, status: "PENDING_ACCEPTANCE", currentAcceptance: { ...project.currentAcceptance, state: "QA_APPROVED" } }, { id: "qa", role: "ADMIN" }).canArchive).toBe(false);
  expect(projectCapabilities({ ...project, status: "COMPLETED" }, { id: "pm", role: "PM" }).canActivate).toBe(true);
});
it("HTML reports escape untrusted names and JSON evidence without executable markup", () => {
  const html = closureHtml({ project: { id: "id", name: '<script>alert("x")</script>' }, snapshotSha256: "a".repeat(64), evidence: { title: "<img src=x onerror=alert(1)>" } });
  expect(html).not.toContain("<script>"); expect(html).not.toContain("<img"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("只读报告");
});
