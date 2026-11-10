import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
const db = new PrismaClient(); let owner: string; let outsider: string; const prefix = `Synthetic Browse ${randomUUID().slice(0,8)}`;
test.use({ trace: "off" }); test.setTimeout(90000);
test.beforeAll(async () => {
  await db.$transaction(async tx => {
    owner = (await tx.user.create({ data: { name: "Synthetic project list PM", email: `${randomUUID()}@medpm.local`, role: "PM", status: "ACTIVE" } })).id;
    outsider = (await tx.user.create({ data: { name: "Synthetic outsider", email: `${randomUUID()}@medpm.local`, role: "PM", status: "ACTIVE" } })).id;
    for (let i = 0; i < 25; i++) await tx.project.create({ data: { name: `${prefix}-${String(i).padStart(2,"0")}`, description: i === 24 ? "unique-description-match" : "Synthetic list fixture", status: i % 2 ? "ACTIVE" : "PLANNING", ownerId: owner } });
    for (const status of ["PENDING_ACCEPTANCE", "ON_HOLD", "ARCHIVED", "CANCELLED", "COMPLETED"] as const) await tx.project.create({ data: { name: `${prefix}-${status}`, status, ownerId: owner } });
    await tx.project.create({ data: { name: "Synthetic-private-secret-name", ownerId: outsider, status: "ACTIVE" } });
  }, { timeout: 15000 });
});
test.afterAll(() => db.$disconnect());
test.beforeEach(async ({ context, baseURL, page }) => {
  await context.addCookies([{ name: "medpm_session", value: createSessionToken(owner, Date.now() + 3600000), url: baseURL!, httpOnly: true }]);
  await page.goto("/projects");
});
test("default is current projects with compact status filters and bounded pages", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "当前项目 · 找到 25 个项目", exact: true })).toBeVisible();
  const list = page.getByRole("region", { name: "项目列表", exact: true }); await expect(list.locator("article")).toHaveCount(12);
  await expect(list).not.toContainText("已归档"); await expect(list).not.toContainText("已取消");
  await expect(page.getByRole("navigation", { name: "项目分页", exact: true })).toContainText("第 1 / 3 页");
});
test("name search can widen to archived history and clear filters", async ({ page }) => {
  await page.getByLabel("项目搜索关键词", { exact: true }).fill(`${prefix}-ARCHIVED`); await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("region", { name: "项目空结果", exact: true })).toBeVisible(); await page.getByRole("link", { name: "搜索全部状态", exact: true }).click();
  await expect(page.getByRole("region", { name: "项目列表", exact: true })).toContainText(`${prefix}-ARCHIVED`);
  await expect(page.getByLabel("项目搜索关键词", { exact: true })).toHaveValue(`${prefix}-ARCHIVED`);
  await page.getByRole("form", { name: "查找项目", exact: true }).getByRole("link", { name: "恢复默认", exact: true }).click();
  await expect(page.getByLabel("项目搜索关键词", { exact: true })).toHaveValue(""); await expect(page.getByRole("heading", { name: "当前项目 · 找到 25 个项目", exact: true })).toBeVisible();
});
test("search, sort and page survive refresh, browser back and the project return link", async ({ page }) => {
  await page.getByLabel("项目搜索关键词", { exact: true }).fill(prefix); await page.getByLabel("项目排序", { exact: true }).selectOption("name_asc"); await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("link", { name: "下一页", exact: true }).click(); const filtered = page.url();
  await expect(page.getByRole("region", { name: "项目列表", exact: true }).locator("article").first()).toContainText(`${prefix}-12`);
  await page.reload(); await expect(page.getByLabel("项目排序", { exact: true })).toHaveValue("name_asc");
  const item = page.getByRole("link", { name: `${prefix}-12`, exact: true }); await item.click();
  await expect(page.getByRole("main", { name: "项目任务工作区", exact: true })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(filtered); await item.click();
  await page.getByRole("main", { name: "项目任务工作区", exact: true }).getByRole("link", { name: "返回项目看板", exact: true }).click();
  await expect(page).toHaveURL(filtered); await expect(page.getByLabel("项目搜索关键词", { exact: true })).toHaveValue(prefix);
  await page.getByRole("region", { name: "项目状态概览", exact: true }).getByRole("link", { name: /^已归档/ }).click();
  await expect(page).toHaveURL(/status=ARCHIVED/); expect(new URL(page.url()).searchParams.has("page")).toBe(false); await expect(page.getByLabel("项目排序", { exact: true })).toHaveValue("name_asc");
});
test("description search and private-project probing return accurate scoped counts", async ({ page }) => {
  await page.getByLabel("项目搜索关键词", { exact: true }).fill("unique-description-match"); await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("heading", { name: "当前项目 · 找到 1 个项目", exact: true })).toBeVisible();
  await page.goto("/projects?view=all&q=private-secret-name"); await expect(page.getByRole("heading", { name: "全部项目 · 找到 0 个项目", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "项目状态概览", exact: true })).not.toContainText("1");
});
test("narrow layout stays within viewport and stale page numbers recover", async ({ page }) => {
  await page.goto("/projects?page=999"); await expect(page).toHaveURL(/page=3$/); await expect(page.getByRole("region", { name: "项目列表", exact: true }).locator("article")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByLabel("项目搜索关键词", { exact: true })).toBeVisible();
});
