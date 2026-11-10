import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
const db = new PrismaClient(); const pm = "00000000-0000-4000-8000-000000000002";
let projectId: string, taskId: string, prerequisite: string;
test.use({ trace: "off", viewport: { width: 1440, height: 1050 } });
test.beforeEach(async ({ page, context, baseURL }) => {
  await db.$transaction(async tx => {
    projectId = (await tx.project.create({ data: { name: `合成任务管理闭环 ${randomUUID().slice(0, 6)}`, ownerId: pm } })).id;
    prerequisite = (await tx.task.create({ data: { projectId, title: "合成前置任务", description: "所属阶段：项目启动", plannedStartDate: new Date("2026-10-19T00:00:00Z"), dueDate: new Date("2026-10-20T00:00:00Z"), estimateHours: 2 } })).id;
    taskId = (await tx.task.create({ data: { projectId, title: "合成计划安排任务", description: "所属阶段：项目启动", estimateHours: 4 } })).id;
  });
  await context.addCookies([{ name: "medpm_session", value: createSessionToken(pm, Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]);
  await page.goto(`/projects/${projectId}/board?taskId=${taskId}`);
});
test.afterAll(() => db.$disconnect());
async function edit(page: Page) { const editor = page.locator("details").filter({ has: page.getByText("编辑计划安排", { exact: true }) }); if (await editor.getAttribute("open") === null) await editor.locator("summary").click(); await expect(editor.getByRole("button", { name: "保存任务计划", exact: true })).toBeEnabled(); return editor; }

test("task drawer owns planned dates, effort and dependencies; Gantt reflects the committed plan", async ({ page }) => {
  const editor = await edit(page);
  await editor.getByLabel("计划开始日期", { exact: true }).fill("2026-10-21"); await editor.getByLabel("计划完成日期", { exact: true }).fill("2026-10-24"); await editor.getByLabel("计划预计工时", { exact: true }).fill("12");
  await editor.getByRole("checkbox", { name: /合成前置任务/ }).check();
  const saved = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(`/api/tasks/${taskId}/schedule`)); await editor.getByRole("button", { name: "保存任务计划", exact: true }).click(); expect((await saved).status()).toBe(200);
  await expect(page.getByRole("region", { name: "计划信息", exact: true })).toContainText("12 小时");
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId }, include: { dependencies: true } }); expect(task.planningStatus).toBe("SCHEDULED"); expect(task.scheduleVersion).toBe(1); expect(task.dependencies[0].dependsOnTaskId).toBe(prerequisite);
  const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: taskId, action: "TASK_SCHEDULE_UPDATED" } }); expect(audit.after).toMatchObject({ estimateHours: 12, dueDate: "2026-10-24", dependencyIds: [prerequisite] });
  await page.goto(`/projects/${projectId}/planning`);
  await expect(page.locator(`.bar-wrapper[data-id="${taskId}"]`)).toBeVisible(); await expect(page.locator(".gantt .arrow path")).toHaveCount(1);
  await expect(page.getByLabel("甘特任务列表")).toContainText("10-21 → 10-24"); await expect(page.locator("input")).toHaveCount(0);
});

test("a real 409 discards the stale draft, reloads the current version and supports an explicit retry", async ({ page }) => {
  let intercepted = false;
  await page.route(`**/api/tasks/${taskId}/schedule`, async route => { if (!intercepted) { intercepted = true; await db.$transaction(tx => tx.task.update({ where: { id: taskId }, data: { estimateHours: 6, scheduleVersion: { increment: 1 } } })); } const response = await route.fetch(); await route.fulfill({ response }); });
  let editor = await edit(page); await editor.getByLabel("计划预计工时", { exact: true }).fill("99");
  const conflict = page.waitForResponse(r => r.url().endsWith(`/api/tasks/${taskId}/schedule`) && r.request().method() === "PATCH"); await editor.getByRole("button", { name: "保存任务计划", exact: true }).click(); expect((await conflict).status()).toBe(409);
  await expect(page.getByText("计划版本已更新，已重新读取，请核对后再保存", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "计划信息", exact: true })).toContainText("6 小时");
  editor = await edit(page); await expect(editor.getByLabel("计划预计工时", { exact: true })).toHaveValue("6");
  await editor.getByLabel("计划预计工时", { exact: true }).fill("8");
  const saved = page.waitForResponse(r => r.url().endsWith(`/api/tasks/${taskId}/schedule`) && r.request().method() === "PATCH"); await editor.getByRole("button", { name: "保存任务计划", exact: true }).click(); expect((await saved).status()).toBe(200);
  expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).scheduleVersion).toBe(2); expect(await db.auditLog.count({ where: { entityId: taskId, action: "TASK_SCHEDULE_UPDATED" } })).toBe(1);
});

test("failed saves retain the draft and never change task data or audit evidence", async ({ page }) => {
  await page.route(`**/api/tasks/${taskId}/schedule`, route => route.fulfill({ status: 503, json: { error: "合成计划保存暂不可用" } }));
  const editor = await edit(page); await editor.getByLabel("计划预计工时", { exact: true }).fill("10"); await editor.getByRole("button", { name: "保存任务计划", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("合成计划保存暂不可用"); await expect(editor.getByLabel("计划预计工时", { exact: true })).toHaveValue("10");
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } }); expect(Number(task.estimateHours)).toBe(4); expect(task.scheduleVersion).toBe(0); expect(await db.auditLog.count({ where: { entityId: taskId, action: "TASK_SCHEDULE_UPDATED" } })).toBe(0);
});

test("member onboarding blocks navigation during an outstanding save and then goes directly to task management", async ({ page }) => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${projectId}/members`, async route => { if (route.request().method() === "PUT") { await held; const response = await route.fetch(); await route.fulfill({ response }); } else await route.continue(); });
  await page.goto(`/projects/${projectId}/members?onboarding=1`);
  const next = page.getByRole("link", { name: "完成人员配置，进入任务管理 →", exact: true });
  await expect(next).toHaveAttribute("aria-disabled", "false");
  await page.getByLabel("待添加成员", { exact: true }).selectOption("00000000-0000-4000-8000-000000000004");
  const saving = page.waitForRequest(r => r.method() === "PUT" && r.url().endsWith(`/api/projects/${projectId}/members`)); await page.getByRole("button", { name: "添加成员", exact: true }).click(); await saving;
  try { await expect(next).toHaveAttribute("aria-disabled", "true"); await next.click({ force: true }); await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/members\\?onboarding=1$`)); }
  finally { release(); }
  await expect(next).toHaveAttribute("aria-disabled", "false"); await next.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/board\\?onboarding=1$`));
  await expect(page.getByRole("region", { name: "新项目引导" })).toContainText("第 2 步 / 共 2 步");
});
