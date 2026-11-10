import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
const db = new PrismaClient(); const pm = "00000000-0000-4000-8000-000000000002";
let projectId: string, taskId: string;
const name = "合成演示 · 医院 EMR 交付项目";
const reason = "客户预算审批暂缓，项目暂停执行，待资源确认后恢复。";
test.use({ trace: "off", viewport: { width: 1440, height: 1050 } });
test.beforeEach(async ({ context, baseURL }) => {
  await db.$transaction(async tx => {
    projectId = (await tx.project.create({ data: { name, ownerId: pm, status: "ACTIVE" } })).id;
    taskId = (await tx.task.create({ data: { projectId, title: "合成项目计划任务", description: "所属阶段：项目启动", status: "IN_PROGRESS", plannedStartDate: new Date("2026-10-19T00:00:00Z"), dueDate: new Date("2026-10-23T00:00:00Z"), estimateHours: 8 } })).id;
  });
  await context.addCookies([{ name: "medpm_session", value: createSessionToken(pm, Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]);
  await mkdir("test-results/lifecycle-evidence", { recursive: true });
});
test.afterAll(() => db.$disconnect());

test("pause requires an explanation and disables task completion and every Gantt drag handle; resume restores editing", async ({ page }) => {
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByRole("button", { name: "完成", exact: true })).toBeEnabled({ timeout: 15000 });
  await page.getByRole("button", { name: "暂停项目", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "暂停项目", exact: true });
  await expect(dialog.getByRole("button", { name: "确认暂停项目", exact: true })).toBeDisabled();
  await dialog.getByLabel("暂停说明").fill("   "); await expect(dialog.getByRole("button", { name: "确认暂停项目" })).toBeDisabled();
  await dialog.getByLabel("暂停说明").fill(reason); if (process.env.E2E_CAPTURE_EVIDENCE === "1") await dialog.screenshot({ path: "test-results/lifecycle-evidence/pause-reason.png" });
  await dialog.getByRole("button", { name: "确认暂停项目" }).click();
  await expect(page.getByText("⏸ 项目已暂停 · 业务资料已冻结")).toBeVisible();
  await expect(page.getByRole("button", { name: "完成", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "创建任务", exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "恢复项目", exact: true })).toBeVisible();
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/lifecycle-evidence/paused-board.png", fullPage: true });
  const denied = await page.request.patch(`/api/tasks/${taskId}`, { data: { status: "TODO" } }); expect(denied.status()).toBe(403); expect(await denied.json()).toMatchObject({ code: "PROJECT_FROZEN" });
  await page.goto(`/projects/${projectId}/planning`); await expect(page.locator(`.bar-wrapper[data-id="${taskId}"]`)).toBeVisible();
  await expect(page.locator(".handle:visible")).toHaveCount(0); if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/lifecycle-evidence/paused-gantt.png", fullPage: true });
  await page.getByRole("button", { name: "恢复项目", exact: true }).click(); const resume = page.getByRole("dialog", { name: "恢复项目", exact: true });
  await resume.getByLabel("恢复说明").fill("客户预算和人员已经到位，确认恢复正常交付执行。"); await resume.getByRole("button", { name: "确认恢复项目" }).click();
  await expect(page.getByText("⏸ 项目已暂停 · 业务资料已冻结")).toHaveCount(0);
  await page.goto(`/projects/${projectId}/board`); await expect(page.getByRole("button", { name: "完成", exact: true })).toBeEnabled({ timeout: 15000 });
  expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("ACTIVE");
});

test("cancel confirms the project name, preserves evidence, and exposes no recovery or editing entry", async ({ page }) => {
  await page.goto(`/projects/${projectId}/board`); await page.getByRole("button", { name: "取消项目", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "取消项目", exact: true }); await dialog.getByLabel("取消说明").fill("客户正式终止合同，本项目取消，所有历史交付证据保留。");
  await expect(dialog.getByRole("button", { name: "确认取消项目" })).toBeDisabled(); await dialog.getByLabel("输入完整项目名称以确认").fill(name);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await dialog.screenshot({ path: "test-results/lifecycle-evidence/cancel-confirmation.png" }); await dialog.getByRole("button", { name: "确认取消项目" }).click();
  await expect(page.getByText("⛔ 项目已取消 · 永久只读")).toBeVisible();
  for (const label of ["暂停项目", "恢复项目", "取消项目"]) await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "完成", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "状态记录", exact: true }).click(); await expect(page.getByLabel("项目状态变更记录")).toContainText("客户正式终止合同");
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/lifecycle-evidence/cancelled-board.png", fullPage: true });
  for (const action of ["activate", "resume"]) {
    const response = await page.request.post(`/api/projects/${projectId}/${action}`, { data: { expectedRowVersion: 2, requestKey: randomUUID(), ...(action === "resume" ? { reason } : { comment: "" }) } });
    expect(response.status()).toBe(403); expect(await response.json()).toMatchObject({ code: "PROJECT_FROZEN" });
  }
  expect(await db.task.count({ where: { projectId } })).toBe(1); expect(await db.auditLog.count({ where: { projectId, action: "PROJECT_CANCELLED" } })).toBe(1);
});

test("another session pausing during a stale task edit returns 403, clears the draft and refreshes into readonly", async ({ page }) => {
  await page.goto(`/projects/${projectId}/board?taskId=${taskId}`); await expect(page.getByRole("dialog", { name: /任务详情/ })).toBeVisible();
  const editor = page.locator("details").filter({ has: page.getByText("编辑计划安排", { exact: true }) }); await editor.locator("summary").click(); await editor.getByLabel("计划预计工时", { exact: true }).fill("99");
  const response = await page.request.post(`/api/projects/${projectId}/pause`, { data: { expectedRowVersion: 1, requestKey: randomUUID(), reason } }); expect(response.status()).toBe(200);
  const rejected = page.waitForResponse(r => r.url().endsWith(`/api/tasks/${taskId}/schedule`) && r.request().method() === "PATCH");
  await editor.getByRole("button", { name: "保存任务计划", exact: true }).click(); expect((await rejected).status()).toBe(403);
  await expect(page.getByText("项目已暂停，页面已切换为只读", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "保存任务计划", exact: true })).toHaveCount(0);
  await expect(page.getByText("⏸ 项目已暂停 · 业务资料已冻结")).toBeVisible();
  expect(Number((await db.task.findUniqueOrThrow({ where: { id: taskId } })).estimateHours)).toBe(8);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/lifecycle-evidence/stale-edit-frozen.png", fullPage: true });
});

test("QA cannot pause, and a successful state change with a failed refresh is announced truthfully", async ({ page, browser, baseURL }) => {
  const qa = await browser.newContext(); await qa.addCookies([{ name: "medpm_session", value: createSessionToken("00000000-0000-4000-8000-000000000004", Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]);
  await db.$transaction(tx => tx.projectMember.create({ data: { projectId, userId: "00000000-0000-4000-8000-000000000004" } }));
  const denied = await qa.request.post(`/api/projects/${projectId}/pause`, { data: { expectedRowVersion: 1, requestKey: randomUUID(), reason } }); expect(denied.status()).toBe(403); await qa.close();
  await page.goto(`/projects/${projectId}/board`); await page.getByRole("button", { name: "暂停项目", exact: true }).click();
  await page.getByLabel("暂停说明").fill(reason);
  await page.route(`**/api/projects/${projectId}/lifecycle`, route => route.abort());
  await page.getByRole("button", { name: "确认暂停项目" }).click();
  await expect(page.getByText("操作已成功，但数据刷新失败，请手动刷新", { exact: true })).toBeVisible();
  expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("ON_HOLD");
});

test("a delayed ACTIVE lifecycle response cannot unlock a project after a committed pause", async ({ page }) => {
  await page.goto(`/projects/${projectId}/board`); await expect(page.getByRole("button", { name: "完成", exact: true })).toBeEnabled({ timeout: 15000 });
  let release!: () => void, captured!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { captured = resolve; }); let first = true;
  await page.route(`**/api/projects/${projectId}/lifecycle`, async route => {
    if (!first) return route.continue(); first = false;
    const response = await route.fetch(); captured(); await held;
    await route.fulfill({ response, headers: { ...response.headers(), "x-test-stale": "1" } });
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await ready;
    await page.getByRole("button", { name: "暂停项目", exact: true }).click(); await page.getByLabel("暂停说明").fill(reason); await page.getByRole("button", { name: "确认暂停项目" }).click();
    await expect(page.getByText("⏸ 项目已暂停 · 业务资料已冻结")).toBeVisible(); await expect(page.getByRole("button", { name: "恢复项目", exact: true })).toBeVisible();
    const late = page.waitForResponse(response => response.headers()["x-test-stale"] === "1"); release(); await late;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole("button", { name: "完成", exact: true })).toBeDisabled(); await expect(page.getByText("⏸ 项目已暂停 · 业务资料已冻结")).toBeVisible();
  } finally { release(); }
});
