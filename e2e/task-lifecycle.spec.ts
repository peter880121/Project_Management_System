import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
const db = new PrismaClient(); const pm = "00000000-0000-4000-8000-000000000002", member = "00000000-0000-4000-8000-000000000003";
let projectId: string, taskId: string, dependentId: string;
const reason = "客户确认需求范围已移除，取消该任务并重新评估后续依赖。";
test.use({ trace: "off", viewport: { width: 1440, height: 1050 } });
test.beforeEach(async ({ context, baseURL }) => {
  await db.$transaction(async tx => {
    projectId = (await tx.project.create({ data: { name: "合成演示 · 任务取消与重开", ownerId: pm, status: "ACTIVE" } })).id;
    await tx.projectMember.create({ data: { projectId, userId: member } });
    taskId = (await tx.task.create({ data: { projectId, title: "合成待取消任务", description: "所属阶段：项目启动", status: "IN_PROGRESS", assigneeId: member, plannedStartDate: new Date("2026-10-19T00:00:00Z"), dueDate: new Date("2026-10-23T00:00:00Z"), estimateHours: 8 } })).id;
    dependentId = (await tx.task.create({ data: { projectId, title: "合成后续交付任务", description: "所属阶段：项目启动", status: "TODO" } })).id;
    await tx.taskDependency.create({ data: { taskId: dependentId, dependsOnTaskId: taskId } });
  });
  await context.addCookies([{ name: "medpm_session", value: createSessionToken(pm, Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await mkdir("test-results/task-lifecycle-evidence", { recursive: true });
});
test.afterAll(() => db.$disconnect());

test("cancel autofocuses reason, folds the terminal card and warns on dependent card and drawer", async ({ page }) => {
  await page.goto(`/projects/${projectId}/board`); const card = page.locator(`[data-task-card="${taskId}"]`); await expect(card).toBeVisible({ timeout: 15000 });
  await card.getByLabel("更多操作 合成待取消任务").click(); await card.getByRole("button", { name: "取消任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "取消任务", exact: true }); await expect(dialog.getByLabel("取消原因")).toBeFocused(); await expect(dialog.getByRole("button", { name: "确认取消任务" })).toBeDisabled();
  await dialog.getByLabel("取消原因").fill(reason); if (process.env.E2E_CAPTURE_EVIDENCE === "1") await dialog.screenshot({ path: "test-results/task-lifecycle-evidence/cancel-reason.png" }); await dialog.getByRole("button", { name: "确认取消任务" }).click();
  const cancelled = page.getByLabel("已取消任务", { exact: true }); await expect(cancelled).not.toHaveAttribute("open"); await expect(cancelled.locator("summary")).toContainText("1");
  const dependent = page.locator(`[data-task-card="${dependentId}"]`); await expect(dependent).toContainText("前置任务已被取消，请重新评估依赖");
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/task-lifecycle-evidence/dependency-warning.png", fullPage: true });
  await dependent.getByRole("link", { name: "合成后续交付任务" }).click(); await expect(page.getByRole("dialog", { name: "任务详情", exact: true })).toContainText("前置任务已被取消，请重新评估依赖"); await page.getByRole("button", { name: "关闭任务详情" }).click();
  await cancelled.locator("summary").click(); await expect(card).toContainText("已取消"); await card.getByRole("link", { name: "合成待取消任务" }).click();
  const drawer = page.getByRole("dialog", { name: "任务详情", exact: true }); await expect(drawer.getByText("已取消 · 只读", { exact: true })).toBeVisible();
  for (const input of await drawer.locator("input,select,textarea").all()) await expect(input).toBeDisabled();
  await drawer.getByRole("tab", { name: "📎 交付物管理" }).click(); for (const input of await drawer.locator("input,select,textarea").all()) await expect(input).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "保存交付版本" })).toBeDisabled(); if (process.env.E2E_CAPTURE_EVIDENCE === "1") await drawer.screenshot({ path: "test-results/task-lifecycle-evidence/cancelled-drawer.png" });
  await page.goto(`/projects/${projectId}/planning`); await expect(page.locator(`.bar-wrapper[data-id="${taskId}"]`)).toHaveClass(/is-cancelled/); await expect(page.locator(".handle:visible")).toHaveCount(0);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/task-lifecycle-evidence/cancelled-gantt.png", fullPage: true });
});

test("MEMBER can flag a block but cannot cancel even with a forged request", async ({ page, context, baseURL }) => {
  await context.clearCookies(); await context.addCookies([{ name: "medpm_session", value: createSessionToken(member, Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]);
  await page.goto(`/projects/${projectId}/board`); const card = page.locator(`[data-task-card="${taskId}"]`); await expect(card.getByRole("button", { name: "标记受阻", exact: true })).toBeEnabled({ timeout: 15000 }); await expect(card.getByLabel("更多操作 合成待取消任务")).toHaveCount(0);
  const rejected = await page.request.patch(`/api/tasks/${taskId}`, { data: { status: "CANCELLED", cancelReason: reason, expectedRowVersion: 1 } }); expect(rejected.status()).toBe(403);
  expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("IN_PROGRESS");
});

test("a pending signature cannot complete a task cancelled by another session", async ({ page }) => {
  await page.goto(`/projects/${projectId}/board`); const card = page.locator(`[data-task-card="${taskId}"]`); await card.getByRole("button", { name: "完成", exact: true }).click();
  const signature = page.getByRole("dialog", { name: "电子签名", exact: true }); await signature.getByLabel("签名实际工时").fill("2"); await signature.getByLabel("签名密码", { exact: true }).fill(process.env.LOCAL_DEV_SEED_PASSWORD!);
  const cancelled = await page.request.patch(`/api/tasks/${taskId}`, { data: { status: "CANCELLED", cancelReason: reason, expectedRowVersion: 1 } }); expect(cancelled.status()).toBe(200);
  const blocked = page.waitForResponse(response => response.url().endsWith(`/api/tasks/${taskId}`) && response.request().method() === "PATCH"); await signature.getByRole("button", { name: "确认签署" }).click(); expect((await blocked).status()).toBe(409);
  await expect(page.getByText("任务已取消，禁止修改、分配或签署", { exact: true }).first()).toBeVisible(); expect(await db.auditLog.count({ where: { entityId: taskId, action: "TASK_SIGNED_AND_COMPLETED" } })).toBe(0);
});

test("same-day reopen clears actuals and old round, then a fresh signature creates independent evidence", async ({ page }) => {
  await page.goto(`/projects/${projectId}/board?taskId=${taskId}`); let drawer = page.getByRole("dialog", { name: "任务详情", exact: true });
  await drawer.getByRole("button", { name: "完成", exact: true }).click(); let signature = page.getByRole("dialog", { name: "电子签名", exact: true }); await signature.getByLabel("签名实际工时").fill("2"); await signature.getByLabel("签名密码", { exact: true }).fill(process.env.LOCAL_DEV_SEED_PASSWORD!); await signature.getByRole("button", { name: "确认签署" }).click(); await expect(signature).toHaveCount(0);
  const first = await db.task.findUniqueOrThrow({ where: { id: taskId } }); expect(first.status).toBe("DONE");
  page.once("dialog", dialog => dialog.accept()); await drawer.getByRole("button", { name: "重新打开", exact: true }).click();
  await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("IN_PROGRESS"); const reopened = await db.task.findUniqueOrThrow({ where: { id: taskId } }); expect(reopened).toMatchObject({ actualHours: null, completedAt: null, completionRoundId: null, signatureEvidenceVersion: 2 });
  await page.reload(); drawer = page.getByRole("dialog", { name: "任务详情", exact: true }); await drawer.getByRole("button", { name: "完成", exact: true }).click(); signature = page.getByRole("dialog", { name: "电子签名", exact: true }); await signature.getByLabel("签名实际工时").fill("3"); await signature.getByLabel("签名密码", { exact: true }).fill(process.env.LOCAL_DEV_SEED_PASSWORD!); await signature.getByRole("button", { name: "确认签署" }).click(); await expect(signature).toHaveCount(0);
  const second = await db.task.findUniqueOrThrow({ where: { id: taskId } }); expect(second.completionRoundId).not.toBe(first.completionRoundId); expect(await db.auditLog.count({ where: { entityId: taskId, action: "TASK_REOPENED" } })).toBe(1);
});

test("a committed cancellation stays readonly when both board and drawer refresh fail", async ({ page }) => {
  await page.goto(`/projects/${projectId}/board?taskId=${taskId}`); const drawer = page.getByRole("dialog", { name: "任务详情", exact: true });
  await drawer.getByLabel("更多操作 合成待取消任务").click(); await drawer.getByRole("button", { name: "取消任务", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "取消任务", exact: true }); await dialog.getByLabel("取消原因").fill(reason);
  await page.route(`**/api/projects/${projectId}/tasks`, route => route.fulfill({ status: 503, json: { error: "Synthetic board refresh outage" } }));
  await page.route(`**/api/tasks/${taskId}`, route => route.request().method() === "GET" ? route.fulfill({ status: 503, json: { error: "Synthetic detail refresh outage" } }) : route.continue());
  await dialog.getByRole("button", { name: "确认取消任务" }).click(); await expect(dialog).toHaveCount(0);
  await expect(drawer.getByText("已取消 · 只读", { exact: true })).toBeVisible(); await expect(drawer.getByText("任务已取消，但详情刷新失败，请手动刷新", { exact: true })).toBeVisible();
  for (const input of await drawer.locator("input,select,textarea").all()) await expect(input).toBeDisabled();
  expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("CANCELLED"); expect(await db.auditLog.count({ where: { entityId: taskId, action: "TASK_CANCELLED" } })).toBe(1);
});
