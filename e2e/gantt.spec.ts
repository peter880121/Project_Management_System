import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
const db = new PrismaClient();
let projectId: string; let sourceId: string; let dependentId: string; let doneId: string;
test.use({ channel: process.env.ACCEPTANCE_EDGE === "1" ? "msedge" : undefined });
test.beforeAll(async () => {
  await db.$transaction(async tx => {
    projectId = (await tx.project.create({ data: { name: "Synthetic 医疗软件交付计划", ownerId: "00000000-0000-4000-8000-000000000002" } })).id;
    await tx.projectMember.createMany({ data: ["3", "4"].map(suffix => ({ projectId, userId: `00000000-0000-4000-8000-00000000000${suffix}` })) });
    const rows: { id: string }[] = [];
    const phases = ["需求与蓝图", "需求与蓝图", "系统配置", "验证与测试"];
    for (const [index, title] of ["业务需求调研", "蓝图方案确认", "系统参数与接口联调", "系统集成测试 SIT"].entries()) rows.push(await tx.task.create({ data: { projectId, title, description: `所属阶段：${phases[index]}\nSynthetic delivery plan`, plannedStartDate: new Date(Date.UTC(2026, 9, 19 + index * 4)), dueDate: new Date(Date.UTC(2026, 9, 21 + index * 4, 23, 59, 59, 999)), estimateHours: 4 } }));
    sourceId = rows[0].id; dependentId = rows[1].id;
    await tx.taskDependency.createMany({ data: rows.slice(1).map((row, index) => ({ taskId: row.id, dependsOnTaskId: rows[index].id })) });
    doneId = (await tx.task.create({ data: { projectId, title: "项目初验", description: "所属阶段：验收与运维", status: "DONE", plannedStartDate: new Date("2026-11-05T00:00:00Z"), dueDate: new Date("2026-11-05T23:59:59.999Z"), estimateHours: 8, actualHours: 8, completedAt: new Date("2026-11-05T12:00:00Z") } })).id;
    await tx.task.create({ data: { projectId, title: "项目终验与移交（未排期）", description: "所属阶段：验收与运维" } });
  });
});
test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "medpm_session", value: createSessionToken("00000000-0000-4000-8000-000000000002", Date.now() + 3_600_000), url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(`/projects/${projectId}/planning`);
  await expect(page.locator(`.bar-wrapper[data-id="${sourceId}"]`)).toBeVisible({ timeout: 15_000 });
});
test.afterAll(() => db.$disconnect());
const bar = (page: Page, id: string) => page.locator(`.bar-wrapper[data-id="${id}"] .bar`).first();
async function drag(page: Page, id: string, distance = 45, resize = false) {
  const target = resize ? page.locator(`.bar-wrapper[data-id="${id}"] .handle.right`) : bar(page, id);
  // Raw mouse coordinates need the same visibility/stability checks as locator actions.
  await expect.poll(() => page.locator(".gantt-container").evaluate(element => element.style.getPropertyValue("--gv-column-width"))).toBe("45px");
  await target.scrollIntoViewIfNeeded();
  await target.click({ trial: true });
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + distance, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
}

test("default Gantt shows dependencies, changes granularity, opens existing drawer, and has a table fallback", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("button", { name: "甘特图视图", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".gantt .arrow path")).toHaveCount(3);
  await expect(page.locator(`.bar-wrapper[data-id="${sourceId}"]`)).toHaveClass(/phase-1/);
  await expect(page.getByLabel("甘特任务列表")).toContainText("[需求与蓝图] 业务需求调研");
  await page.getByRole("region", { name: "项目甘特图", exact: true }).screenshot({ path: "test-results/ia-gantt-phase-prefix.png" });
  await expect(page.getByRole("button", { name: "项目终验与移交（未排期）", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/gantt-desktop.png", fullPage: true });
  for (const mode of ["Day", "Month", "Week"]) { await page.getByLabel("甘特图时间粒度").selectOption(mode); await expect(page.locator(".gantt .arrow path")).toHaveCount(3); }
  await bar(page, sourceId).click();
  const drawer = page.getByRole("dialog", { name: "任务详情", exact: true });
  await expect(drawer.getByRole("heading", { name: "业务需求调研", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  const timeline = page.locator(".gantt-container");
  expect(await timeline.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await timeline.evaluate(element => { element.scrollLeft += 200; });
  await page.screenshot({ path: "test-results/gantt-narrow.png", fullPage: true });
  await page.getByRole("button", { name: "表格视图", exact: true }).click();
  await expect(page.getByLabel("开始日期 业务需求调研", { exact: true })).toHaveValue("2026-10-19");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/gantt-table.png", fullPage: true });
});

test("late phase metadata does not replace SVG nodes during a drag", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${projectId}/tasks`, async route => { await held; await route.continue(); });
  try {
    await page.reload();
    await expect(bar(page, sourceId)).toBeVisible();
    await page.getByLabel("甘特图时间粒度").selectOption("Day");
    await expect.poll(() => page.locator(".gantt-container").evaluate(element => element.style.getPropertyValue("--gv-column-width"))).toBe("45px");
    const target = bar(page, sourceId);
    await target.click({ trial: true });
    await target.evaluate(element => { element.setAttribute("data-drag-probe", "original"); });
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    release();
    await expect(page.getByLabel("甘特任务列表")).toContainText("[需求与蓝图]");
    await expect(target).toHaveAttribute("data-drag-probe", "original");
    const saved = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes(`/api/tasks/${sourceId}/schedule`));
    await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole("button", { name: "刷新排期", exact: true })).toBeEnabled();
  } finally { release(); await page.mouse.up(); }
});

test("drag and resize persist through the existing versioned API without moving dependent tasks", async ({ page }) => {
  await page.getByLabel("甘特图时间粒度").selectOption("Day");
  const previous = await db.task.findUniqueOrThrow({ where: { id: sourceId } });
  const auditCount = await db.auditLog.count({ where: { entityId: sourceId, action: "TASK_SCHEDULE_UPDATED" } });
  const dependent = await db.task.findUniqueOrThrow({ where: { id: dependentId } });
  const saved = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes(`/api/tasks/${sourceId}/schedule`));
  await drag(page, sourceId);
  const response = await saved; expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({ expectedVersion: previous.scheduleVersion, estimateHours: 4, dependencyIds: [] });
  await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: sourceId } })).scheduleVersion).toBe(previous.scheduleVersion + 1);
  await expect(page.getByRole("button", { name: "刷新排期", exact: true })).toBeEnabled();
  const resized = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes(`/api/tasks/${sourceId}/schedule`));
  await drag(page, sourceId, 45, true);
  expect((await resized).status()).toBe(200);
  expect((await db.task.findUniqueOrThrow({ where: { id: dependentId } })).plannedStartDate).toEqual(dependent.plannedStartDate);
  expect(await db.auditLog.count({ where: { entityId: sourceId, action: "TASK_SCHEDULE_UPDATED" } })).toBe(auditCount + 2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a real 409 reloads the new version and physically rolls the bar back", async ({ page }) => {
  await page.getByLabel("甘特图时间粒度").selectOption("Day");
  const before = await db.task.findUniqueOrThrow({ where: { id: sourceId } });
  const oldX = Number(await bar(page, sourceId).getAttribute("x"));
  expect((await page.request.patch(`/api/tasks/${sourceId}/schedule`, { data: { expectedVersion: before.scheduleVersion, plannedStartDate: before.plannedStartDate!.toISOString().slice(0, 10), dueDate: before.dueDate!.toISOString().slice(0, 10), estimateHours: 6, dependencyIds: [] } })).status()).toBe(200);
  const conflict = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes(`/api/tasks/${sourceId}/schedule`));
  await drag(page, sourceId);
  const response = await conflict; expect(response.status()).toBe(409);
  expect(response.request().postDataJSON().expectedVersion).toBe(before.scheduleVersion);
  await expect(page.getByRole("status").filter({ hasText: "排期版本已更新，请刷新后重试" })).toBeVisible();
  await expect.poll(async () => Number(await bar(page, sourceId).getAttribute("x"))).toBe(oldX);
  await page.screenshot({ path: "test-results/gantt-conflict.png", fullPage: true });
  await page.getByRole("button", { name: "表格视图", exact: true }).click();
  await expect(page.getByLabel("预计工时 业务需求调研", { exact: true })).toHaveValue("6");
  expect((await db.task.findUniqueOrThrow({ where: { id: sourceId } })).scheduleVersion).toBe(before.scheduleVersion + 1);
});

test("completed tasks and QA are read-only; failed writes restore physical dates", async ({ page, context, baseURL }) => {
  await page.getByLabel("甘特图时间粒度").selectOption("Day");
  let patches = 0;
  await page.route("**/api/tasks/*/schedule", async route => { patches++; await route.fulfill({ status: 503, json: { error: "Synthetic schedule unavailable" } }); });
  await bar(page, doneId).scrollIntoViewIfNeeded();
  await drag(page, doneId); expect(patches).toBe(0);
  await bar(page, sourceId).scrollIntoViewIfNeeded();
  const oldX = Number(await bar(page, sourceId).getAttribute("x"));
  await drag(page, sourceId);
  await expect(page.getByRole("status").filter({ hasText: "Synthetic schedule unavailable" })).toBeVisible();
  await expect.poll(async () => Number(await bar(page, sourceId).getAttribute("x"))).toBe(oldX);
  expect(patches).toBe(1);
  await context.addCookies([{ name: "medpm_session", value: createSessionToken("00000000-0000-4000-8000-000000000004", Date.now() + 3_600_000), url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  await page.reload();
  await expect(bar(page, sourceId)).toBeVisible();
  await page.getByLabel("甘特图时间粒度").selectOption("Day");
  await drag(page, sourceId); expect(patches).toBe(1);
});
