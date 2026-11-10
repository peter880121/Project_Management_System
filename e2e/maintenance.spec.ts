import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
const db = new PrismaClient(); const pm = "00000000-0000-4000-8000-000000000002", member = "00000000-0000-4000-8000-000000000003";
let projectId: string, taskId: string, successor: string;
const name = "合成项目 · 基本信息与交接";
test.use({ trace: "off" });
test.beforeEach(async ({ context, baseURL }) => {
  await db.$transaction(async tx => {
    successor = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: `合成交接 PM ${randomUUID().slice(0, 8)}`, role: "PM", status: "ACTIVE" } })).id;
    projectId = (await tx.project.create({ data: { name, description: "合成原始说明", ownerId: pm, status: "ACTIVE" } })).id;
    await tx.projectMember.create({ data: { projectId, userId: member } });
    taskId = (await tx.task.create({ data: { projectId, title: "合成待编辑任务", description: "所属阶段：项目启动\n合成任务说明", status: "TODO", estimateHours: 8 } })).id;
    await tx.task.create({ data: { projectId, title: "验证分组折叠的合成任务", description: "所属阶段：验证与测试", status: "TODO" } });
  });
  await context.addCookies([{ name: "medpm_session", value: createSessionToken(pm, Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]);
});
test.afterAll(() => db.$disconnect());
test("project settings saves details and renders the renamed project on its board", async ({ page }) => {
  const detail = await page.request.get(`/api/projects/${projectId}`); expect(detail.status()).toBe(200); expect((await detail.json()).data).toMatchObject({ name, ownerId: pm });
  await page.goto(`/projects/${projectId}/board`); await page.getByRole("button", { name: "更多项目功能", exact: true }).click(); await page.getByRole("menuitem", { name: "项目设置", exact: true }).click();
  const form = page.getByRole("form", { name: "项目基本信息" }); await form.getByLabel("项目名称").fill("合成更新项目名称"); await form.getByLabel("项目说明").fill("更新后的合成业务范围"); await form.getByRole("button", { name: "保存项目基本信息" }).click();
  await expect.poll(async () => (await db.project.findUniqueOrThrow({ where: { id: projectId } })).name).toBe("合成更新项目名称");
  await expect(page.getByText("项目基本信息已保存", { exact: true }).first()).toBeVisible(); await page.getByRole("link", { name: "返回任务看板" }).click(); await expect(page.getByRole("heading", { name: "合成更新项目名称", exact: true })).toBeVisible();
});
test("handoff changes owner, removes old owner controls and permits new owner to edit", async ({ page, context, baseURL }) => {
  await page.goto(`/projects/${projectId}/settings`); const form = page.getByRole("form", { name: "项目负责人交接" });
  await form.getByLabel("新负责人").selectOption(successor); await form.getByLabel("交接说明").fill("项目经理岗位调整，确认将后续交付管理职责完整交接。"); await form.getByLabel("输入项目名称确认").fill(name);
  page.once("dialog", dialog => dialog.accept()); await form.getByRole("button", { name: "确认交接负责人" }).click();
  await expect.poll(async () => (await db.project.findUniqueOrThrow({ where: { id: projectId } })).ownerId).toBe(successor);
  await expect(page.getByRole("button", { name: "保存项目基本信息" })).toBeDisabled();
  const denied = await page.request.patch(`/api/projects/${projectId}`, { data: { operation: "details", expectedRowVersion: 2, name: "越权修改", description: "" } }); expect(denied.status()).toBe(403);
  await context.clearCookies(); await context.addCookies([{ name: "medpm_session", value: createSessionToken(successor, Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]); await page.reload();
  await expect(page.getByRole("button", { name: "保存项目基本信息" })).toBeEnabled();
});
test("task text and phase edits reveal the new group and survive a page reload", async ({ page }) => {
  await page.goto(`/projects/${projectId}/board?taskId=${taskId}`); const drawer = page.getByRole("dialog", { name: "任务详情", exact: true });
  await drawer.getByText("编辑任务基本信息", { exact: true }).click(); const form = drawer.getByRole("form", { name: "任务基本信息" });
  await form.getByLabel("任务标题").fill("合成修改后的任务"); await form.getByLabel("所属阶段").fill("验证与测试"); await form.getByLabel("任务说明").fill("新的合成执行说明"); await form.getByRole("button", { name: "保存任务基本信息" }).click();
  await expect(drawer.getByRole("heading", { name: "合成修改后的任务", exact: true })).toBeVisible(); await page.getByRole("button", { name: "关闭任务详情" }).click();
  const card = page.locator(`[data-task-card="${taskId}"]`); await expect(card).toBeVisible(); await expect(card).toContainText("合成修改后的任务");
  await page.reload(); await expect(page.getByRole("dialog", { name: "任务详情", exact: true })).toContainText("新的合成执行说明");
});
test("a stale project edit returns 409 without overwriting concurrent work", async ({ page }) => {
  await page.goto(`/projects/${projectId}/settings`); const form = page.getByRole("form", { name: "项目基本信息" }); await form.getByLabel("项目名称").fill("不应覆盖的新名称");
  expect((await page.request.patch(`/api/projects/${projectId}`, { data: { operation: "details", expectedRowVersion: 1, name: "另一会话已保存", description: "" } })).status()).toBe(200);
  const conflict = page.waitForResponse(response => response.url().endsWith(`/api/projects/${projectId}`) && response.request().method() === "PATCH"); await form.getByRole("button", { name: "保存项目基本信息" }).click(); expect((await conflict).status()).toBe(409);
  expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).name).toBe("另一会话已保存");
});
test("MEMBER sees readonly settings and cannot forge task content changes", async ({ page, context, baseURL }) => {
  await context.clearCookies(); await context.addCookies([{ name: "medpm_session", value: createSessionToken(member, Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]);
  await page.goto(`/projects/${projectId}/settings`); await expect(page.getByRole("button", { name: "保存项目基本信息" })).toBeDisabled();
  const denied = await page.request.patch(`/api/tasks/${taskId}`, { data: { operation: "details", expectedRowVersion: 1, title: "伪造内容", description: "", phase: "项目启动" } }); expect(denied.status()).toBe(403);
  await page.goto(`/projects/${projectId}/board?taskId=${taskId}`); await expect(page.getByRole("dialog", { name: "任务详情", exact: true })).toBeVisible(); await expect(page.getByText("编辑任务基本信息", { exact: true })).toHaveCount(0);
});
