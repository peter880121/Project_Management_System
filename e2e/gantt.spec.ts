import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
const db = new PrismaClient();
let projectId: string; let sourceId: string; let dependentId: string; let doneId: string;
test.use({ trace: "off", channel: process.env.ACCEPTANCE_EDGE === "1" ? "msedge" : undefined });
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
test("chart CSS survives board navigation, refresh and mode changes with a readable grid", async ({ page }) => {
  test.setTimeout(90000); await page.goto(`/projects/${projectId}/board`);
  await page.getByRole("navigation", { name: "项目功能", exact: true }).getByRole("link", { name: "甘特图", exact: true }).click();
  const assertStyled = async () => {
    await expect(bar(page, sourceId)).toBeVisible();
    await expect(page.locator(".medpm-gantt .gantt-container")).toHaveCSS("position", "relative");
    await expect(page.locator(".medpm-gantt .grid-background")).toHaveCSS("fill", "none");
    await expect(page.locator(".medpm-gantt .grid-row").first()).toHaveCSS("fill", "rgb(255, 255, 255)");
    await expect(page.locator(".medpm-gantt .lower-text").first()).toHaveCSS("position", "absolute");
  };
  await assertStyled(); await page.reload(); await assertStyled();
  for (const mode of ["Day", "Month", "Week"]) { await page.getByLabel("甘特图时间粒度").selectOption(mode); await assertStyled(); }
  await page.getByRole("button", { name: "刷新甘特图", exact: true }).click(); await assertStyled();
  if (process.env.E2E_CAPTURE_GANTT_FIX === "1") await page.screenshot({ path: "test-results/gantt-styles-fixed.png" });
});

test("missing chart CSS degrades to a usable read-only list instead of a black SVG", async ({ page }) => {
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.textContent = ".medpm-gantt{--medpm-gantt-css-ready:0!important}"; document.head.append(style); }));
  await page.reload(); await expect(page.getByRole("alert").filter({ hasText: "只读任务列表" })).toBeVisible();
  await expect(page.locator(".medpm-gantt svg")).toHaveCount(0);
  await page.getByRole("alert").getByRole("button", { name: /业务需求调研/ }).click(); await expect(page.getByRole("dialog", { name: "任务详情（只读）", exact: true })).toBeVisible();
});
test("Gantt is presentation only, preserves dependencies and opens a read-only drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let writes = 0; page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) writes++; });
  await expect(page.locator(".gantt .arrow path")).toHaveCount(3);
  await expect(page.getByLabel("甘特任务列表")).toContainText("[需求与蓝图] 业务需求调研");
  await expect(page.getByRole("button", { name: "表格视图", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "成员周容量" })).toHaveCount(0);
  await expect(page.locator("input")).toHaveCount(0);
  for (const mode of ["Day", "Month", "Week"]) { await page.getByLabel("甘特图时间粒度").selectOption(mode); await expect(page.locator(".gantt .arrow path")).toHaveCount(3); }
  await page.getByLabel("甘特任务列表").getByRole("button", { name: "业务需求调研", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "任务详情（只读）", exact: true });
  await expect(drawer.getByRole("heading", { name: "业务需求调研", exact: true })).toBeVisible();
  await expect(drawer.locator("input,select,textarea")).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "完成", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: "前往任务管理", exact: true })).toHaveAttribute("href", `/projects/${projectId}/board?taskId=${sourceId}`);
  expect(writes).toBe(0);
  await drawer.getByRole("button", { name: "关闭任务详情", exact: true }).click();
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/gantt-readonly.png", fullPage: true });
});
test("dragging is disabled for PM, QA and completed tasks without changing the database", async ({ page, context, baseURL }) => {
  let writes = 0; page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) writes++; });
  for (const [suffix, id] of [["2", sourceId], ["2", doneId], ["4", dependentId], ["1", sourceId], ["3", sourceId]]) {
    await context.addCookies([{ name: "medpm_session", value: createSessionToken(`00000000-0000-4000-8000-00000000000${suffix}`, Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]);
    await page.reload(); await page.getByLabel("甘特图时间粒度").selectOption("Day");
    const before = await db.task.findUniqueOrThrow({ where: { id } });
    const target = bar(page, id); await target.scrollIntoViewIfNeeded(); await target.click({ trial: true });
    const x = await target.getAttribute("x"); const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
    expect(await target.getAttribute("x")).toBe(x); expect(writes).toBe(0);
    expect(await db.task.findUniqueOrThrow({ where: { id } })).toEqual(before);
    await expect(page.locator(".gantt .handle:visible")).toHaveCount(0);
  }
});
test("pending tasks remain visible, chart failures fall back to a read-only list", async ({ page }) => {
  await expect(page.getByRole("button", { name: "项目终验与移交（未排期）", exact: true })).toBeVisible();
  await page.addInitScript(() => {
    const append = HTMLDivElement.prototype.appendChild;
    HTMLDivElement.prototype.appendChild = function<T extends Node>(node: T): T { if (this.classList.contains("gantt-container") && node instanceof SVGSVGElement) throw new Error("Synthetic Gantt initialization failure"); return append.call(this, node) as T; };
  });
  await page.reload();
  const fallback = page.getByRole("region", { name: "项目甘特图", exact: true }).getByRole("alert");
  await expect(fallback).toContainText("只读任务列表");
  await fallback.getByRole("button", { name: /业务需求调研/ }).click();
  await expect(page.getByRole("dialog", { name: "任务详情（只读）", exact: true })).toBeVisible();
  await expect(page.locator("input,select:not([aria-label='甘特图时间粒度']),textarea")).toHaveCount(0);
});
