import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";
import { createSessionToken } from "../src/modules/auth/session-token";

// Read existing synthetic fixtures only; this suite does not write business data.
const atlasId = "00000000-0000-4000-8000-000000000065";
const beaconId = "00000000-0000-4000-8000-000000000066";
const atlasPath = `/projects/${atlasId}/board`;
const beaconPath = `/projects/${beaconId}/board`;
let task: { id: string; title: string };
test.use({ channel: process.env.ACCEPTANCE_EDGE === "1" ? "msedge" : undefined });
test.setTimeout(90_000);
test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const found = await db.task.findFirst({ where: { projectId: atlasId }, select: { id: true, title: true }, orderBy: { title: "asc" } });
    if (!found) throw new Error("Existing synthetic Atlas task required; no fixture is created by this suite.");
    task = found;
  } finally { await db.$disconnect(); }
});
test.beforeEach(async ({ context, baseURL, page }) => {
  await context.addCookies([{ name: "medpm_session", value: createSessionToken("00000000-0000-4000-8000-000000000002", Date.now() + 3_600_000), url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  await page.route("**/api/**", route => ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 409, json: { error: "Mutations blocked in layout review" } }));
});

test("home has no breadcrumbs; project list and board show server labels and correct ancestors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "面包屑", exact: true })).toHaveCount(0);
  await expect(page.getByRole("banner", { name: "顶部栏" })).toHaveCSS("height", "56px");
  await page.screenshot({ path: "test-results/layout-step2a-home.png", fullPage: true });
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "项目", exact: true }).click();
  const crumbs = page.getByRole("navigation", { name: "面包屑", exact: true });
  await expect(crumbs).toHaveText("项目");
  await page.screenshot({ path: "test-results/layout-step2a-projects.png", fullPage: true });
  await page.getByRole("link", { name: "Atlas Release Readiness", exact: true }).click();
  await expect(crumbs.locator("li")).toHaveText(["项目", "Atlas Release Readiness", "看板"]);
  await expect(crumbs.getByRole("link")).toHaveCount(1);
  await expect(crumbs.getByRole("link", { name: "项目", exact: true })).toHaveAttribute("href", "/projects");
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText("看板");
  await page.screenshot({ path: "test-results/layout-step2a-board.png", fullPage: true });
  await crumbs.getByRole("link", { name: "项目", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(crumbs).toHaveText("项目");
});

test("task detail reuses its project association and links back to its board", async ({ page }) => {
  await page.goto(`/tasks/${task.id}`);
  const crumbs = page.getByRole("navigation", { name: "面包屑", exact: true });
  await expect(crumbs.locator("li")).toHaveText(["项目", "Atlas Release Readiness", "看板", task.title]);
  await expect(crumbs.getByRole("link", { name: "看板", exact: true })).toHaveAttribute("href", atlasPath);
  await expect(crumbs.getByRole("link", { name: "Atlas Release Readiness", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/layout-step2a-task.png", fullPage: true });
  await crumbs.getByRole("link", { name: "看板", exact: true }).click();
  await expect(page).toHaveURL(atlasPath);
  await expect(crumbs.locator("li")).toHaveText(["项目", "Atlas Release Readiness", "看板"]);
});

test("avatar menu supports keyboard navigation, escape, outside click and Tab exit", async ({ page }) => {
  await page.goto(atlasPath);
  const trigger = page.getByRole("button", { name: "用户菜单", exact: true });
  const menu = page.getByRole("menu", { name: "用户菜单", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("PM", { exact: true })).toBeVisible();
  await expect(menu.getByText(/@/)).toBeVisible();
  const profile = menu.getByRole("menuitem", { name: "个人资料", exact: true });
  const logout = menu.getByRole("menuitem", { name: "登出", exact: true });
  await expect(profile).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(logout).toBeFocused();
  await page.screenshot({ path: "test-results/layout-step2a-menu-keyboard.png", fullPage: true });
  await page.keyboard.press("ArrowUp");
  await expect(profile).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Space");
  await expect(profile).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(profile).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("heading", { name: "Atlas Release Readiness", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await profile.click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(menu).toHaveCount(0);
});

test("client navigation Atlas to Beacon never carries Atlas breadcrumbs into the new route", async ({ page }) => {
  await page.goto(atlasPath);
  const crumbs = page.getByRole("navigation", { name: "面包屑", exact: true });
  await expect(crumbs).toContainText("Atlas Release Readiness");
  await page.evaluate(() => {
    const state = window as typeof window & { breadcrumbSamples: { path: string; text: string }[] };
    state.breadcrumbSamples = [];
    const sample = () => state.breadcrumbSamples.push({ path: location.pathname, text: document.querySelector('nav[aria-label="面包屑"]')?.textContent ?? "" });
    sample();
    new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await crumbs.getByRole("link", { name: "项目", exact: true }).click();
  await expect(crumbs).toHaveText("项目");
  await page.getByRole("link", { name: "Beacon Validation Upgrade", exact: true }).click();
  await expect(page).toHaveURL(beaconPath);
  await expect(crumbs.locator("li")).toHaveText(["项目", "Beacon Validation Upgrade", "看板"]);
  const samples = await page.evaluate(() => (window as typeof window & { breadcrumbSamples: { path: string; text: string }[] }).breadcrumbSamples);
  expect(samples.some(sample => sample.path === beaconPath)).toBe(true);
  expect(samples.filter(sample => sample.path !== atlasPath).every(sample => !sample.text.includes("Atlas Release Readiness"))).toBe(true);
  await writeFile("test-results/layout-step2a-switch-evidence.json", JSON.stringify({ route: [atlasPath, "/projects", beaconPath], samples }, null, 2));
  await page.screenshot({ path: "test-results/layout-step2a-board-beacon.png", fullPage: true });
  await page.goBack();
  await expect(crumbs).toHaveText("项目");
  await page.goBack();
  await expect(crumbs).toContainText("Atlas Release Readiness");
});

test("narrow layout keeps the topbar visible without covering content and supports the drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByRole("navigation", { name: "面包屑", exact: true })).toContainText(task.title);
  const header = page.getByRole("banner", { name: "顶部栏" });
  const headerBox = await header.boundingBox();
  const contentBox = await page.locator("main").boundingBox();
  expect(headerBox?.height).toBe(56);
  expect(contentBox!.y).toBeGreaterThanOrEqual(56);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/layout-step2a-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await expect(page.getByRole("menu", { name: "用户菜单", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/layout-step2a-mobile-menu.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "全局侧边栏", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "打开导航", exact: true })).toBeFocused();
});
