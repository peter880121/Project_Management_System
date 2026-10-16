import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";

const db = new PrismaClient();
const runId = randomUUID();
let password: string; let projectId: string; let changeRequirementId: string;
const qaId = randomUUID(); const pmId = randomUUID();
const emails = [`compliance-test-${runId}-qa@medpm.local`, `compliance-test-${runId}-pm@medpm.local`];
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || "";
  if (!password) throw new Error("Set LOCAL_DEV_SEED_PASSWORD for compliance E2E");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    for (const [index, role] of (["QA", "PM"] as const).entries()) await tx.user.create({ data: { id: index === 0 ? qaId : pmId, email: emails[index], name: "Synthetic Compliance", passwordHash, role, status: "ACTIVE" } });
    projectId = (await tx.project.create({ data: { name: `Synthetic compliance ${runId}`, ownerId: pmId } })).id;
    await tx.projectMember.create({ data: { projectId, userId: qaId } });
    const complete = await tx.requirement.create({ data: { projectId, title: "Synthetic reviewed requirement", content: "Synthetic release criteria", status: "APPROVED" } });
    changeRequirementId = complete.id;
    const review = { reviewedRequirementVersion: 1, requirementReviewedById: qaId, requirementReviewedAt: new Date() };
    const task = await tx.task.create({ data: { projectId, title: "Synthetic change task", requirementId: complete.id, status: "DONE", ...review } });
    await tx.testCase.create({ data: { requirementId: complete.id, title: "Synthetic change test", status: "PASSED", ...review } });
    await tx.task.create({ data: { projectId, title: "Synthetic unlinked task" } });
    await tx.requirement.create({ data: { projectId, title: "Synthetic orphan requirement", content: "Synthetic gap", status: "APPROVED" } });
    const failed = await tx.requirement.create({ data: { projectId, title: "Synthetic failed requirement", content: "Synthetic test failure", status: "APPROVED" } });
    await tx.task.create({ data: { projectId, title: "Synthetic failed task", status: "DONE", requirementId: failed.id } });
    await tx.testCase.create({ data: { requirementId: failed.id, title: "Synthetic failed test", status: "FAILED" } });
    await tx.auditLog.create({ data: { actorId: qaId, projectId, action: "TASK_CREATED", entityType: "Task", entityId: task.id, after: { synthetic: true } } });
  });
});
test.afterAll(async () => {
  try { await db.$transaction((tx) => tx.session.deleteMany({ where: { user: { email: { in: emails } } } })); }
  finally { await db.$disconnect(); }
});

test("QA scans six gaps, reviews findings and summary, follows evidence, and rechecks changed versions", async ({ page, browser }) => {
  test.setTimeout(120000);
  expect((await page.request.post("/api/auth/login", { data: { email: emails[0], password } })).status()).toBe(200);
  await page.goto("/audit");
  await page.getByLabel("选择审计项目", { exact: true }).selectOption(projectId);
  await page.getByRole("button", { name: "生成合规摘要", exact: true }).click();
  const panel = page.getByRole("region", { name: "合规审计摘要", exact: true });
  await expect(panel.getByRole("heading", { name: "合规审计摘要 · PENDING", exact: true })).toBeVisible({ timeout: 45000 });
  for (const code of ["TASK_WITHOUT_REQUIREMENT", "APPROVED_REQUIREMENT_WITHOUT_TASK", "REQUIREMENT_WITHOUT_TEST", "DONE_TASK_WITH_UNPASSED_TEST", "TASK_REQUIREMENT_REVIEW_STALE", "TEST_REQUIREMENT_REVIEW_STALE"]) await expect(panel.getByRole("heading", { name: code, exact: true }).first()).toBeVisible();
  const finding = panel.locator("article").filter({ has: page.getByRole("heading", { name: "TASK_WITHOUT_REQUIREMENT", exact: true }) });
  await finding.getByLabel("问题复核说明", { exact: true }).fill("Confirmed synthetic missing requirement; PM to correct.");
  await finding.getByRole("button", { name: "提交问题复核", exact: true }).click();
  await expect(finding.getByText(/CONFIRMED/)).toBeVisible();
  await panel.getByLabel("摘要复核说明", { exact: true }).fill("Reviewed synthetic snapshot; acceptance does not approve release.");
  await panel.getByRole("button", { name: "提交摘要复核", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "合规审计摘要 · ACCEPTED", exact: true })).toBeVisible();
  await page.reload(); await page.getByLabel("选择审计项目", { exact: true }).selectOption(projectId);
  await page.getByRole("button", { name: "查询历史摘要", exact: true }).click();
  await page.getByRole("button", { name: /ACCEPTED/ }).click();
  await expect(page.getByText("Confirmed synthetic missing requirement; PM to correct.", { exact: false })).toBeVisible();

  const pm = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    expect((await pm.request.post("/api/auth/login", { data: { email: emails[1], password } })).status()).toBe(200);
    expect((await pm.request.post("/api/audit/summary", { data: { projectId } })).status()).toBe(403);
    expect((await pm.request.post(`/api/projects/${projectId}/traceability`, { data: { kind: "requirement", title: "Synthetic new requirement", content: "Synthetic", status: "DRAFT" } })).status()).toBe(201);
    expect((await pm.request.patch(`/api/projects/${projectId}/traceability`, { data: { kind: "requirement", id: changeRequirementId, expectedVersion: 1, title: "Synthetic reviewed requirement", content: "Updated synthetic release criteria", status: "APPROVED" } })).status()).toBe(200);
  } finally { await pm.close(); }
  await page.goto(`/projects/${projectId}/traceability`);
  const taskRow = page.locator("li").filter({ hasText: "Synthetic change task" });
  await expect(taskRow.getByText(/已过期/)).toBeVisible();
  await taskRow.getByLabel("版本复核说明", { exact: true }).fill("Task reviewed against synthetic version 2");
  await taskRow.getByRole("button", { name: "确认适配当前需求版本", exact: true }).click();
  await expect(taskRow.getByText("当前需求 v2 · 已复核版本：2", { exact: true })).toBeVisible();
  // A reviewed version emits an audit reference that can be opened outside a filtered list.
  await page.goto("/audit"); await page.getByLabel("选择审计项目", { exact: true }).selectOption(projectId);
  await page.getByRole("button", { name: "生成合规摘要", exact: true }).click();
  await expect(page.getByRole("heading", { name: "合规审计摘要 · PENDING", exact: true })).toBeVisible({ timeout: 45000 });
  await page.getByRole("link", { name: /^审计记录 / }).first().click();
  await expect(page.getByRole("heading", { name: "原始审计记录", exact: true })).toBeVisible();
});
