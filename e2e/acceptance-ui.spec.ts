import { expect, test, type BrowserContext } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
import { createDatabaseSessionCredential } from "../src/modules/auth/session-token";
import { PrismaClient } from "@prisma/client";

// Read synthetic seed data and mock business mutations. The profile test owns one temporary Session.
const projectId = "00000000-0000-4000-8000-000000000065";
const board = `/projects/${projectId}/board`;
test.use({ channel: process.env.ACCEPTANCE_EDGE === "1" ? "msedge" : undefined });
async function identity(context: BrowserContext, baseURL: string, role: "ADMIN" | "PM" | "MEMBER" | "QA") {
  const suffix = { ADMIN: "1", PM: "2", MEMBER: "3", QA: "4" }[role];
  await context.addCookies([{ name: "medpm_session", value: createSessionToken(`00000000-0000-4000-8000-00000000000${suffix}`, Date.now() + 3_600_000), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async route => {
    if (!["GET", "HEAD"].includes(route.request().method())) return route.fulfill({ status: 409, json: { error: "Mutation blocked in UI acceptance test" } });
    return route.continue();
  });
});

test("guest home provides authentication and actual Agent entry points", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "主导航", exact: true });
  await expect(nav.getByRole("link", { name: "登录", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "注册账号" })).toBeVisible();
  await expect(page.getByText("待接入", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "选择项目，使用 WBS" })).toHaveAttribute("href", "/projects");
  await page.screenshot({ path: "test-results/acceptance-home.png", fullPage: true });
  for (const path of ["/login", "/register"]) {
    await page.goto(path);
    await expect(page.getByRole("complementary", { name: "全局侧边栏", exact: true })).toHaveCount(0);
  }
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login\?next=/);
});

for (const role of ["ADMIN", "PM", "MEMBER", "QA"] as const) {
  test(`${role} sees shared navigation throughout the project workflow`, async ({ page, context, baseURL }) => {
    // Six page visits plus screenshots exceeded the 30s total budget; each step still waits on real UI state.
    test.setTimeout(90_000);
    await identity(context, baseURL!, role);
    if (["ADMIN", "MEMBER"].includes(role)) {
      await page.goto("/");
      await expect(page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "首页", exact: true })).toHaveAttribute("aria-current", "page");
      await page.screenshot({ path: `test-results/layout-step1-home-${role.toLowerCase()}.png`, fullPage: true });
      if (role === "MEMBER") {
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByRole("navigation", { name: "主导航", exact: true })).toBeHidden();
        await page.screenshot({ path: "test-results/layout-step1-mobile-collapsed.png", fullPage: true });
        await page.getByRole("button", { name: "打开导航", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "全局侧边栏", exact: true })).toBeVisible();
        await expect(page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "审计", exact: true })).toHaveCount(0);
        await page.screenshot({ path: "test-results/layout-step1-mobile-open.png", fullPage: true });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "打开导航", exact: true })).toBeFocused();
        await page.setViewportSize({ width: 1280, height: 720 });
      }
    }
    for (const url of [board, `/projects/${projectId}/traceability`, `/projects/${projectId}/documents`, `/projects/${projectId}/planning`, `/projects/${projectId}/members`]) {
      await page.goto(url);
      const nav = page.getByRole("navigation", { name: "主导航", exact: true });
      await expect(nav).toHaveCount(1);
      await expect(nav.getByRole("link", { name: "项目", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(nav.getByRole("link", { name: "首页", exact: true })).toBeVisible();
      await expect(nav.getByRole("button", { name: "登出", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "用户管理", exact: true })).toHaveCount(role === "ADMIN" ? 1 : 0);
      await expect(nav.getByRole("link", { name: "审计", exact: true })).toHaveCount(["ADMIN", "QA"].includes(role) ? 1 : 0);
      if (role === "PM" && url === board) await page.screenshot({ path: "test-results/layout-step1-board.png", fullPage: true });
    }
    if (role === "PM") {
      await page.getByRole("table", { name: "项目成员列表" }).waitFor({ state: "visible" });
      await expect(page.getByRole("table", { name: "项目成员列表" })).toBeVisible();
      await page.screenshot({ path: "test-results/style-members-desktop.png", fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: "test-results/style-members-mobile.png", fullPage: true });
    }
    if (["ADMIN", "QA"].includes(role)) {
      await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "审计", exact: true }).click();
      await page.waitForURL(url => url.pathname === "/audit");
      await page.getByRole("heading", { name: "审计日志与合规审查", exact: true }).waitFor({ state: "visible" });
      await expect(page.getByRole("heading", { name: "审计日志与合规审查", exact: true })).toBeVisible();
      await page.getByLabel("选择审计项目").selectOption(projectId);
      await expect(page.getByLabel("选择审计项目")).toHaveValue(projectId);
    }
  });
}

test("WBS prerequisites guide acceptance and stale responses cannot restore reviewed cards", async ({ page, context, baseURL }) => {
  await identity(context, baseURL!, "PM");
  const prerequisite = { id: "synthetic-first", output: { title: "Synthetic prerequisite", dependencyIds: [] }, history: [], prerequisites: [] };
  const dependent = { id: "synthetic-second", output: { title: "Synthetic dependent", dependencyIds: [prerequisite.id] }, history: [], prerequisites: [{ id: prerequisite.id, title: prerequisite.output.title, status: "PENDING" }],
    documentEvidence: [1, 2].map(index => ({ id: `00000000-0000-4000-8000-00000000070${index}`, documentId: "00000000-0000-4000-8000-000000000301", version: 1, page: index, filename: "synthetic-medsoft-requirements-v1.pdf", text: "合成软件需求：验证登录失败锁定与审计追溯。", textSha256: "0".repeat(64) })) };
  let accepted = false;
  await page.route(`**/api/projects/${projectId}/ai/wbs`, route => route.fulfill({ json: { data: [
    { ...dependent, prerequisites: [{ ...dependent.prerequisites[0], status: accepted ? "ACCEPTED" : "PENDING" }] },
    prerequisite, // deliberately stale after successful review
  ] } }));
  await page.route(`**/api/ai/wbs/${prerequisite.id}`, async route => { accepted = true; await route.fulfill({ json: { data: {} } }); });
  await page.goto(`/projects/${projectId}/wbs`);
  const first = page.locator(`#suggestion-${prerequisite.id}`);
  const second = page.locator(`#suggestion-${dependent.id}`);
  await expect(second.getByRole("button", { name: "采纳为任务" })).toBeDisabled();
  await expect(second.getByRole("link", { name: "查看前置任务：Synthetic prerequisite" })).toBeVisible();
  await first.getByRole("button", { name: "采纳为任务" }).click();
  await expect(first).toHaveCount(0);
  await expect(second.getByRole("button", { name: "采纳为任务" })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "已采纳此任务建议，并创建正式任务。" })).toBeVisible();
  await page.screenshot({ path: "test-results/acceptance-wbs.png", fullPage: true });
  await page.getByRole("region", { name: "WBS 分解 Agent", exact: true }).screenshot({ path: "test-results/style-pdf-citations.png" });
  expect(context.pages()).toHaveLength(1);
  expect(page.url()).toContain(`/projects/${projectId}/wbs`);
});

test("saving a test case gives feedback beside its form and keeps input on failure", async ({ page, context, baseURL }) => {
  await identity(context, baseURL!, "QA");
  let fail = true;
  await page.route(`**/api/projects/${projectId}/traceability`, async route => {
    const body = route.request().postDataJSON();
    expect(body.kind).toBe("testCase");
    await route.fulfill({ status: fail ? 409 : 200, json: fail ? { error: "Synthetic conflict; retry" } : { data: { id: body.id } } });
  });
  await page.goto(`/projects/${projectId}/traceability`);
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "保存测试用例", exact: true }) }).first();
  await form.getByLabel("测试用例标题", { exact: true }).fill("Synthetic saved case");
  await form.getByRole("button", { name: "保存测试用例", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("Synthetic conflict");
  await expect(form.getByLabel("测试用例标题", { exact: true })).toHaveValue("Synthetic saved case");
  fail = false;
  await form.getByRole("button", { name: "保存测试用例", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("测试用例《Synthetic saved case》已保存");
  await expect(form.getByRole("link", { name: "返回项目看板" })).toBeVisible();
  await page.screenshot({ path: "test-results/acceptance-test-case.png", fullPage: true });
  expect(context.pages()).toHaveLength(1);
});

test("PDF and member selectors have visible boundaries and opening the file chooser stays on the page", async ({ page, context, baseURL }) => {
  await identity(context, baseURL!, "PM");
  await page.goto(`/projects/${projectId}/documents`);
  const file = page.getByLabel("选择 PDF", { exact: true });
  await expect(file).toHaveCSS("border-top-width", "1px");
  const chooser = page.waitForEvent("filechooser");
  await file.click();
  await (await chooser).setFiles([]);
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/documents$`));
  expect(context.pages()).toHaveLength(1);
  await page.goto(`/projects/${projectId}/members`);
  await expect(page.getByLabel("待添加成员", { exact: true })).toHaveCSS("border-top-width", "1px");
});

test("navigation logout shares the password action lock and failures remain recoverable", async ({ page, context, baseURL }) => {
  const db = new PrismaClient();
  const userId = "00000000-0000-4000-8000-000000000002";
  const expiresAt = Date.now() + 3_600_000;
  const credential = createDatabaseSessionCredential(userId, expiresAt);
  try {
  await db.$transaction(tx => tx.session.create({ data: { id: credential.sessionId, userId, tokenHash: credential.tokenHash, expiresAt: new Date(expiresAt), userAgent: "acceptance-ui-owned-fixture" } }));
  await context.addCookies([{ name: "medpm_session", value: credential.credential, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  let finish: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/api/users/me/password", async route => { await waiting; await route.fulfill({ status: 409, json: { error: "Synthetic password conflict" } }); });
  await page.goto("/profile");
  await page.getByLabel("当前密码", { exact: true }).fill("SyntheticOld123");
  await page.getByLabel("新密码", { exact: true }).fill("SyntheticNew123");
  await page.getByLabel("确认新密码", { exact: true }).fill("SyntheticNew123");
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  const logout = page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: "登出", exact: true });
  await expect(logout).toBeDisabled();
  finish!();
  await expect(logout).toBeEnabled();
  await page.route("**/api/auth/logout", route => route.fulfill({ status: 503, json: { error: "Synthetic unavailable" } }));
  await logout.click();
  await expect(page.getByText("登出失败，请重试", { exact: true })).toBeVisible();
  await expect(logout).toBeEnabled();
  await page.route("**/api/auth/logout", route => route.fulfill({ status: 200, json: {}, headers: { "set-cookie": "medpm_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" } }));
  await logout.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "登录", exact: true })).toBeVisible();
  } finally {
    await db.$transaction(tx => tx.session.deleteMany({ where: { id: credential.sessionId, userAgent: "acceptance-ui-owned-fixture" } }));
    await db.$disconnect();
  }
});
