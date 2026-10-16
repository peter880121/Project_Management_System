import { randomUUID } from "node:crypto";
import { PrismaClient, type Role, type UserStatus } from "@prisma/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";

test.describe.configure({ mode: "serial" });
const db = new PrismaClient();
const runId = randomUUID();
const users = new Map<string, { id: string; email: string }>();
const emails = new Set<string>();
let password: string;
function emailFor(key: string) { const email = `users-test-${runId}-${key}@medpm.local`; emails.add(email); return email; }
function user(key: string) { const value = users.get(key); if (!value) throw new Error(`Missing synthetic user ${key}`); return value; }

test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || "";
  if (!password) throw new Error("Set LOCAL_DEV_SEED_PASSWORD before user E2E");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const fixtures: Array<{ key: string; role: Role; status?: UserStatus; isSystem?: boolean }> = [
      ...["workflow", "activate", "self", "page", "conflict", "network", "stale", "security"].map((name) => ({ key: `admin-${name}`, role: "ADMIN" as const })),
      { key: "pm", role: "PM" }, { key: "member", role: "MEMBER" }, { key: "qa", role: "QA" },
      { key: "pending", role: "MEMBER", status: "PENDING" }, { key: "conflict", role: "MEMBER" },
      { key: "system", role: "MEMBER", isSystem: true },
      ...Array.from({ length: 12 }, (_, index) => ({ key: `page-${index}`, role: "QA" as const })),
      { key: "page-system", role: "QA", isSystem: true },
    ];
    for (const fixture of fixtures) {
      const created = await tx.user.create({ data: { name: "Synthetic User Management", email: emailFor(fixture.key), role: fixture.role, status: fixture.status ?? "ACTIVE", isSystem: fixture.isSystem ?? false, passwordHash }, select: { id: true, email: true } });
      users.set(fixture.key, created);
    }
  });
});
test.afterAll(async () => {
  try {
    const where = { user: { email: { in: [...emails], endsWith: "@medpm.local" } } };
    await db.$transaction((tx) => tx.session.deleteMany({ where }));
    expect(await db.session.count({ where })).toBe(0);
  } finally { await db.$disconnect(); }
});

async function signIn(context: BrowserContext, key: string) {
  expect((await context.request.post("/api/auth/login", { data: { email: user(key).email, password } })).status()).toBe(200);
}
async function adminPage(page: Page, key: string, keyword?: string) {
  await signIn(page.context(), `admin-${key}`);
  await page.goto(`/users${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""}`);
  await expect(page.getByRole("heading", { name: "用户管理", exact: true })).toBeVisible();
}
async function confirm(page: Page) {
  const response = page.waitForResponse(response => response.request().method() === "PATCH" && /^\/api\/users\/[^/]+\/(role|status)$/.test(new URL(response.url()).pathname));
  await page.getByRole("dialog", { name: "确认账号变更" }).getByRole("button", { name: "确认变更", exact: true }).click();
  await response;
  await expect(page.getByRole("dialog", { name: "确认账号变更" })).toHaveCount(0);
}
async function noStoredPassword(page: Page) {
  const storage = await page.evaluate(() => ({ ls: JSON.stringify(localStorage), ss: JSON.stringify(sessionStorage), url: location.href }));
  for (const value of Object.values(storage)) expect(value).not.toContain(password);
}

test("guest is redirected to login with users as next", async ({ page }) => {
  await page.goto("/users");
  await expect(page).toHaveURL(url => url.pathname === "/login" && url.searchParams.get("next") === "/users");
});
for (const key of ["pm", "member", "qa"]) {
  test(`${key} cannot use management API/page or see its navigation entry`, async ({ page }) => {
    await signIn(page.context(), key);
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "无权访问用户管理" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "用户管理", exact: true })).toHaveCount(0);
    expect((await page.request.get("/api/users")).status()).toBe(403);
    expect((await page.request.post("/api/users", { data: {} })).status()).toBe(403);
    if (key === "pm") {
      const response = await page.request.get("/api/users/options");
      expect(response.status()).toBe(200);
      const { data } = await response.json();
      expect(data.some((item: { id: string }) => item.id === user("member").id)).toBe(true);
      expect(data.some((item: { id: string }) => [user("system").id, user("pending").id].includes(item.id))).toBe(false);
      for (const item of data) expect(Object.keys(item).sort()).toEqual(["email", "id", "name"]);
    }
  });
}

test("admin creates ACTIVE, changes role, disables and re-enables with audited effects", async ({ page, browser, baseURL }) => {
  const createdEmail = emailFor("created");
  await adminPage(page, "workflow");
  await page.getByRole("button", { name: "创建用户", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建用户", exact: true });
  await dialog.getByLabel("姓名", { exact: true }).fill("Synthetic Created Member");
  await dialog.getByLabel("邮箱", { exact: true }).fill(createdEmail);
  await dialog.getByLabel("初始密码", { exact: true }).fill(password);
  await noStoredPassword(page);
  await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("姓名或邮箱", { exact: true }).fill(createdEmail);
  await page.getByRole("button", { name: "查询", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: createdEmail });
  await expect(row.getByRole("cell", { name: "ACTIVE", exact: true })).toBeVisible();
  await row.getByRole("combobox", { name: `修改 ${createdEmail} 的角色` }).selectOption("QA");
  await row.getByRole("button", { name: "修改角色", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("MEMBER → QA");
  await confirm(page);
  await expect(row.getByRole("cell", { name: "QA", exact: true })).toBeVisible();
  const target = await db.user.findUniqueOrThrow({ where: { email: createdEmail } });
  const victim = await browser.newContext({ baseURL });
  try {
    expect((await victim.request.post("/api/auth/login", { data: { email: createdEmail, password } })).status()).toBe(200);
    expect((await victim.request.get("/api/auth/me")).status()).toBe(200);
    await row.getByRole("button", { name: "禁用", exact: true }).click(); await confirm(page);
    await expect(row.getByRole("cell", { name: "DISABLED", exact: true })).toBeVisible();
    expect((await victim.request.get("/api/auth/me")).status()).toBe(401);
    await row.getByRole("button", { name: "重新启用", exact: true }).click(); await confirm(page);
    await expect(row.getByRole("cell", { name: "ACTIVE", exact: true })).toBeVisible();
    expect((await victim.request.get("/api/auth/me")).status()).toBe(401);
  } finally { await victim.close(); }
  const audit = await db.auditLog.findMany({ where: { actorId: user("admin-workflow").id, entityId: target.id }, orderBy: { createdAt: "asc" } });
  expect(audit.map((entry) => entry.action)).toEqual(["USER_CREATED_BY_ADMIN", "PERMISSION_CHANGED", "USER_STATUS_CHANGED", "USER_STATUS_CHANGED"]);
  expect(audit[1]).toMatchObject({ before: { role: "MEMBER" }, after: { role: "QA" } });
  expect(audit[2]).toMatchObject({ after: { status: "DISABLED", revokedActiveSessionCount: 1 } });
  expect(JSON.stringify(audit)).not.toContain(password); expect(JSON.stringify(audit)).not.toContain(target.passwordHash!);
  await noStoredPassword(page);
});

test("admin activates a PENDING account with a status audit", async ({ page }) => {
  await adminPage(page, "activate", user("pending").email);
  const row = page.getByRole("row").filter({ hasText: user("pending").email });
  await row.getByRole("button", { name: "激活", exact: true }).click(); await confirm(page);
  await expect(row.getByRole("cell", { name: "ACTIVE", exact: true })).toBeVisible();
  expect(await db.auditLog.findFirst({ where: { actorId: user("admin-activate").id, entityId: user("pending").id, action: "USER_STATUS_CHANGED" } })).toMatchObject({ before: { status: "PENDING" }, after: { status: "ACTIVE", revokedActiveSessionCount: 0 } });
});

test("self actions are disabled and system accounts are absent", async ({ page }) => {
  await adminPage(page, "self", user("admin-self").email);
  const row = page.getByRole("row").filter({ hasText: user("admin-self").email });
  await expect(row.getByText("当前账号", { exact: true })).toBeVisible();
  await expect(row.getByRole("combobox")).toBeDisabled();
  await expect(row.getByRole("button", { name: "禁用", exact: true })).toBeDisabled();
  expect((await page.request.patch(`/api/users/${user("admin-self").id}/role`, { data: { role: "PM" } })).status()).toBe(403);
  expect((await page.request.patch(`/api/users/${user("admin-self").id}/status`, { data: { status: "DISABLED" } })).status()).toBe(403);
  await page.getByLabel("姓名或邮箱", { exact: true }).fill(user("system").email);
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByText("没有符合条件的用户", { exact: true })).toBeVisible();
});

test("filter and pagination survive refresh and browser back", async ({ page }) => {
  await adminPage(page, "page");
  await page.getByLabel("角色筛选", { exact: true }).selectOption("QA");
  await page.getByLabel("状态筛选", { exact: true }).selectOption("ACTIVE");
  await page.getByLabel("姓名或邮箱", { exact: true }).fill(`users-test-${runId}-page-`);
  await page.getByLabel("每页数量", { exact: true }).selectOption("10");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(page.getByText("共 12 个用户，第 1 / 2 页", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.reload();
  await expect(page.getByText("共 12 个用户，第 2 / 2 页", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("共 12 个用户，第 1 / 2 页", { exact: true })).toBeVisible();
});

test("a stale disable gets 409 then refresh shows the current status", async ({ page }) => {
  await adminPage(page, "conflict", user("conflict").email);
  const row = page.getByRole("row").filter({ hasText: user("conflict").email });
  await row.getByRole("button", { name: "禁用", exact: true }).click();
  expect((await page.request.patch(`/api/users/${user("conflict").id}/status`, { data: { status: "DISABLED" } })).status()).toBe(200);
  await confirm(page);
  await expect(page.getByRole("alert").filter({ hasText: "账号状态已变化，请刷新" })).toBeVisible();
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(row.getByRole("cell", { name: "DISABLED", exact: true })).toBeVisible();
  expect(await db.auditLog.count({ where: { actorId: user("admin-conflict").id, entityId: user("conflict").id, action: "USER_STATUS_CHANGED" } })).toBe(1);
});

test("create validation and network failures retain input and allow cancellation", async ({ page }) => {
  await adminPage(page, "network");
  await page.getByRole("button", { name: "创建用户", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建用户", exact: true });
  await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
  await expect(dialog.getByText("请输入姓名", { exact: true })).toBeVisible();
  await dialog.getByLabel("姓名", { exact: true }).fill("Synthetic Network Test");
  await dialog.getByLabel("邮箱", { exact: true }).fill(emailFor("network-created"));
  await dialog.getByLabel("初始密码", { exact: true }).fill(password);
  await page.route("**/api/users", (route) => route.abort("failed"));
  await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("无法确认操作结果，请刷新列表确认后再重试");
  await expect(dialog.getByLabel("初始密码", { exact: true })).toHaveValue(password);
  await noStoredPassword(page);
  await dialog.getByRole("button", { name: "取消", exact: true }).click(); await expect(dialog).toHaveCount(0);
});

test("an administrator demoted while the page is open cannot create users", async ({ page, browser, baseURL }) => {
  await adminPage(page, "stale");
  const security = await browser.newContext({ baseURL });
  try {
    await signIn(security, "admin-security");
    expect((await security.request.patch(`/api/users/${user("admin-stale").id}/role`, { data: { role: "PM" } })).status()).toBe(200);
    await page.getByRole("button", { name: "创建用户", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "创建用户", exact: true });
    await dialog.getByLabel("姓名", { exact: true }).fill("Synthetic Forbidden");
    const email = emailFor("forbidden-created");
    await dialog.getByLabel("邮箱", { exact: true }).fill(email);
    await dialog.getByLabel("初始密码", { exact: true }).fill(password);
    await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("会话或权限已变化，请刷新页面。", { exact: false })).toBeVisible();
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await expect(page.getByRole("heading", { name: "无权访问用户管理" })).toBeVisible();
  } finally { await security.close(); }
});
