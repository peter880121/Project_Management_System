import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const runId = randomUUID();
const accounts = new Map<string, { id: string; email: string }>();
const accountIds: string[] = [];
const registerEmails = new Set<string>();
let password: string;
let inviteCode: string;

test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || "";
  if (!password) throw new Error("Set LOCAL_DEV_SEED_PASSWORD before running auth E2E.");
  inviteCode = process.env.REGISTRATION_INVITE_CODE || "";
  if (!inviteCode) throw new Error("Set REGISTRATION_INVITE_CODE for registration E2E.");
  const passwordHash = await hashPassword(password);
  // Each test gets a distinct ACTIVE MEMBER; no shared seed account is modified.
  for (const key of ["home", "next", "unsafe", "authenticated", "invalid", "pending", "locked", "duplicate", "network", "profile-errors", "profile-dual", "logout", "logout-failure", "profile-expired", "logout-expired", "password-network", "password-duplicate"]) {
    const user = await prisma.$transaction((tx) => tx.user.create({
      data: { email: `login-test-${runId}-${key}@medpm.local`, name: "Synthetic Login Test", passwordHash, status: "ACTIVE", role: "MEMBER" },
      select: { id: true, email: true },
    }));
    accounts.set(key, user);
    accountIds.push(user.id);
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: account("pending").id }, data: { status: "PENDING" } });
    await tx.user.update({ where: { id: account("locked").id }, data: { lockedUntil: new Date(Date.now() + 15 * 60_000) } });
  });
});

test.afterAll(async () => {
  try {
    const where = { user: {
      email: { endsWith: "@medpm.local" },
      OR: [{ id: { in: accountIds } }, { email: { in: [...registerEmails] } }],
    } };
    await prisma.$transaction((tx) => tx.session.deleteMany({ where }));
    expect(await prisma.session.count({ where })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

function account(key: string) {
  const user = accounts.get(key);
  if (!user) throw new Error(`Missing test account: ${key}`);
  return user;
}

async function fill(page: Page, key: string) {
  await page.getByLabel("邮箱", { exact: true }).fill(account(key).email);
  await page.getByLabel("密码", { exact: true }).fill(password);
}

async function expectNoStoredPassword(page: Page) {
  const stored = await page.evaluate(() => ({
    ls: JSON.stringify(localStorage), ss: JSON.stringify(sessionStorage), url: location.href,
  }));
  for (const value of Object.values(stored)) expect(value).not.toContain(password);
}

test("login succeeds and loads home without storing the password", async ({ page }) => {
  await page.goto("/login");
  await fill(page, "home");
  await expectNoStoredPassword(page);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.request.get("/api/auth/me")).status()).toBe(200);
  await expectNoStoredPassword(page);
});

test("login returns to a safe next target", async ({ page }) => {
  await page.goto("/login?next=" + encodeURIComponent("/?source=auth"));
  await fill(page, "next");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/\?source=auth$/);
});

test("unsafe next falls back home", async ({ page }) => {
  await page.goto("/login?next=" + encodeURIComponent("//evil.com"));
  await fill(page, "unsafe");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("already authenticated users ignore next and go home", async ({ page }) => {
  const response = await page.request.post("/api/auth/login", { data: { email: account("authenticated").email, password } });
  expect(response.ok()).toBe(true);
  await page.goto("/login?next=" + encodeURIComponent("/?source=ignored"));
  await expect(page).toHaveURL(/\/$/);
});

test("field errors and invalid credentials are shown in their respective places", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("invalid");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("请输入有效的邮箱地址")).toBeVisible();
  await expect(page.getByText("请输入密码", { exact: true })).toBeVisible();
  await expect(page.getByLabel("邮箱", { exact: true })).toBeFocused();
  await fill(page, "invalid");
  await page.getByLabel("密码", { exact: true }).fill(`${password}-wrong`);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("邮箱或密码错误");
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
});

test("pending account displays activation message", async ({ page }) => {
  await page.goto("/login");
  await fill(page, "pending");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("等待管理员激活");
});

test("locked account displays lock message", async ({ page }) => {
  await page.goto("/login");
  await fill(page, "locked");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("账号已锁定");
});

test("pending submission cannot send duplicate requests", async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/login", async (route) => {
    requests += 1;
    await gate;
    await route.continue();
  });
  await page.goto("/login");
  await fill(page, "duplicate");
  try {
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("button", { name: "登录中…" })).toBeDisabled();
    await page.locator("form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
    expect(requests).toBe(1);
  } finally {
    release();
  }
  await expect(page).toHaveURL(/\/$/);
});

test("network failures restore the form and permit retry", async ({ page }) => {
  await page.route("**/api/auth/login", (route) => route.abort("failed"));
  await page.goto("/login");
  await fill(page, "network");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("无法确认登录结果");
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
});

test("register link preserves only the safe next target", async ({ page }) => {
  await page.goto("/login?next=/profile");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await expect(page.getByRole("link", { name: "没有账号？注册账号" })).toHaveAttribute("href", "/register?next=%2Fprofile");
  await expectNoStoredPassword(page);
  await page.goto("/login?next=/register");
  await expect(page.getByRole("link", { name: "没有账号？注册账号" })).toHaveAttribute("href", "/register");
});

function registerEmail(key: string) {
  const email = `register-test-${runId}-${key}@medpm.local`;
  registerEmails.add(email);
  return email;
}

async function fillRegistration(page: Page, email: string) {
  await page.getByLabel("姓名", { exact: true }).fill("Synthetic Registration User");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
}

test("registration omits empty invite, creates PENDING and stays on the result page", async ({ page }) => {
  const email = registerEmail("pending");
  await page.goto("/register?next=/profile");
  await fillRegistration(page, email);
  await expectNoStoredPassword(page);
  const requestPromise = page.waitForRequest("**/api/auth/register");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  const payload = (await requestPromise).postDataJSON();
  expect(payload).not.toHaveProperty("inviteCode");
  expect(payload).not.toHaveProperty("confirmPassword");
  await expect(page.getByRole("status")).toHaveText("注册成功，等待管理员激活");
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page).toHaveURL(/\/register\?next=\/profile$/);
  await expect(page.getByRole("link", { name: "前往登录", exact: true })).toHaveAttribute("href", "/login?next=%2Fprofile");
  expect(await prisma.user.findUnique({ where: { email }, select: { status: true } })).toEqual({ status: "PENDING" });
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  await expectNoStoredPassword(page);
  await page.getByRole("link", { name: "前往登录", exact: true }).click();
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
  await expectNoStoredPassword(page);
});

test("valid invite creates ACTIVE without logging in or redirecting", async ({ page }) => {
  const email = registerEmail("active");
  await page.goto("/register");
  await fillRegistration(page, email);
  await page.getByLabel("邀请码（可选）", { exact: true }).fill(` ${inviteCode} `);
  const requestPromise = page.waitForRequest("**/api/auth/register");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  expect((await requestPromise).postDataJSON().inviteCode).toBe(inviteCode);
  await expect(page.getByRole("status")).toHaveText("注册成功，请登录");
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page).toHaveURL(/\/register$/);
  expect(await prisma.user.findUnique({ where: { email }, select: { status: true } })).toEqual({ status: "ACTIVE" });
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
});

test("registration checks all fields and confirmation before sending requests", async ({ page }) => {
  let requests = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/auth/register")) requests += 1; });
  await page.goto("/register");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByText("请输入姓名", { exact: true })).toBeVisible();
  await expect(page.getByText("请输入有效的邮箱地址", { exact: true })).toBeVisible();
  await expect(page.getByText("密码至少 8 位，且必须包含字母和数字", { exact: true })).toBeVisible();
  await expect(page.getByText("请再次输入密码", { exact: true })).toBeVisible();
  await fillRegistration(page, registerEmail("validation"));
  await page.getByLabel("确认密码", { exact: true }).fill(`${password}x`);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByText("两次输入的密码不一致", { exact: true })).toBeVisible();
  await expect(page.getByLabel("确认密码", { exact: true })).toBeFocused();
  expect(requests).toBe(0);
});

test("invalid invite is mapped to its field without changing the API", async ({ page }) => {
  await page.goto("/register");
  await fillRegistration(page, registerEmail("invalid-invite"));
  await page.getByLabel("邀请码（可选）", { exact: true }).fill(`${inviteCode}-invalid`);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.locator("#inviteCode-error")).toHaveText("邀请码无效");
  await expect(page.getByLabel("邀请码（可选）", { exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "注册", exact: true })).toBeEnabled();
});

test("duplicate registration shows only a generic failure", async ({ page }) => {
  const email = registerEmail("duplicate");
  const created = await page.request.post("/api/auth/register", { data: { name: "Synthetic Duplicate", email, password } });
  expect(created.status()).toBe(201);
  await page.goto("/register");
  await fillRegistration(page, email);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("无法完成注册");
  await expect(page.getByText("邮箱已存在", { exact: true })).toHaveCount(0);
});

test("unrecognized registration status preserves all fields and offers safe login", async ({ page }) => {
  await page.route("**/api/auth/register", (route) => route.fulfill({ status: 201, json: { status: "UNKNOWN" } }));
  await page.goto("/register?next=/profile");
  const email = registerEmail("unknown");
  await fillRegistration(page, email);
  await page.getByLabel("邀请码（可选）", { exact: true }).fill("synthetic-unknown");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("无法确认注册结果，如果账号已创建，请直接登录");
  for (const [label, value] of [["姓名", "Synthetic Registration User"], ["邮箱", email], ["密码", password], ["确认密码", password], ["邀请码（可选）", "synthetic-unknown"]]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
  }
  await expect(page.getByRole("button", { name: "注册", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "前往登录", exact: true })).toHaveAttribute("href", "/login?next=%2Fprofile");
  await expectNoStoredPassword(page);
});

test("registration network failure preserves input and restores submission", async ({ page }) => {
  await page.route("**/api/auth/register", (route) => route.abort("failed"));
  await page.goto("/register");
  await fillRegistration(page, registerEmail("network"));
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("无法确认注册结果");
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue(password);
  await expect(page.getByRole("button", { name: "注册", exact: true })).toBeEnabled();
});

test("registration prevents duplicate submissions while pending", async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/register", async (route) => {
    requests += 1;
    await gate;
    await route.continue();
  });
  await page.goto("/register");
  await fillRegistration(page, registerEmail("single-submit"));
  try {
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await expect(page.getByRole("button", { name: "注册中…" })).toBeDisabled();
    await page.locator("form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
    expect(requests).toBe(1);
  } finally { release(); }
  await expect(page.getByRole("status")).toHaveText("注册成功，等待管理员激活");
});

test("registration navigation drops unsafe next and never carries passwords", async ({ page }) => {
  await page.goto("/register?next=" + encodeURIComponent("//evil.com"));
  await fillRegistration(page, registerEmail("navigation"));
  await expect(page.getByRole("link", { name: "已有账号？去登录" })).toHaveAttribute("href", "/login");
  await expectNoStoredPassword(page);
  await page.getByRole("link", { name: "已有账号？去登录" }).click();
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
  await expectNoStoredPassword(page);
});

async function loginForProfile(page: Page, key: string) {
  const response = await page.request.post("/api/auth/login", { data: { email: account(key).email, password } });
  expect(response.ok()).toBe(true);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
}

async function fillPasswordChange(page: Page, newPassword: string) {
  await page.getByLabel("当前密码", { exact: true }).fill(password);
  await page.getByLabel("新密码", { exact: true }).fill(newPassword);
  await page.getByLabel("确认新密码", { exact: true }).fill(newPassword);
}

test("unauthenticated profile redirects to login and home navigation shows guest links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "登录", exact: true })).toBeVisible();
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?next=\/profile$/);
});

test("profile shows account information and validates password fields", async ({ page }) => {
  await loginForProfile(page, "profile-errors");
  await expect(page.getByRole("region", { name: "当前用户信息" })).toContainText(account("profile-errors").email);
  await expect(page.getByRole("region", { name: "当前用户信息" })).toContainText("MEMBER");
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(page.getByText("请输入当前密码", { exact: true })).toBeVisible();
  const newPassword = `${randomBytes(18).toString("hex")}Aa1`;
  await fillPasswordChange(page, newPassword);
  await page.getByLabel("确认新密码", { exact: true }).fill(`${newPassword}x`);
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(page.getByText("两次输入的密码不一致", { exact: true })).toBeVisible();
  await page.getByLabel("确认新密码", { exact: true }).fill(newPassword);
  await page.getByLabel("当前密码", { exact: true }).fill(`${password}-wrong`);
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(page.locator("#currentPassword-error")).toHaveText("当前密码不正确");
  await expect(page.getByLabel("当前密码", { exact: true })).toBeFocused();
});

test("changing password keeps context A authenticated and rejects context B's captured old cookie", async ({ browser, baseURL }) => {
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  try {
    for (const context of [a, b]) {
      const response = await context.request.post("/api/auth/login", { data: { email: account("profile-dual").email, password } });
      expect(response.ok()).toBe(true);
      expect((await context.request.get("/api/auth/me")).status()).toBe(200);
    }
    // Capture B's credential BEFORE the password change. B never logs in again.
    const oldCookiesB = await b.cookies();
    const oldSessionB = oldCookiesB.find((cookie) => cookie.name === "medpm_session");
    expect(oldSessionB).toBeDefined();
    if (!oldSessionB) throw new Error("Missing context B session cookie");
    const oldCookieHeaderB = `${oldSessionB.name}=${oldSessionB.value}`;
    const oldSessionA = (await a.cookies()).find((cookie) => cookie.name === "medpm_session");
    const pageA = await a.newPage();
    const pageB = await b.newPage();
    await pageA.goto("/profile");
    await pageB.goto("/profile");
    const newPassword = `${randomBytes(18).toString("hex")}Aa1`;
    await fillPasswordChange(pageA, newPassword);
    const changeRequest = pageA.waitForRequest("**/api/users/me/password");
    await pageA.getByRole("button", { name: "修改密码", exact: true }).click();
    expect((await changeRequest).postDataJSON()).not.toHaveProperty("confirmPassword");
    await expect(pageA.getByRole("status")).toHaveText("密码已更新，当前设备保持登录，其他设备需要重新登录");
    await expect(pageA).toHaveURL(/\/profile$/);
    for (const label of ["当前密码", "新密码", "确认新密码"]) await expect(pageA.getByLabel(label, { exact: true })).toHaveValue("");
    expect((await a.request.get("/api/auth/me")).status()).toBe(200);
    const newSessionA = (await a.cookies()).find((cookie) => cookie.name === "medpm_session");
    expect(newSessionA?.value !== oldSessionA?.value).toBe(true);
    expect((await b.cookies()).find((cookie) => cookie.name === "medpm_session")?.value === oldSessionB.value).toBe(true);
    // Explicit replay of the captured credential proves server invalidation, not local deletion.
    expect((await b.request.get("/api/auth/me", { headers: { cookie: oldCookieHeaderB } })).status()).toBe(401);
    await pageB.reload();
    await expect(pageB).toHaveURL(/\/login\?next=\/profile$/);
    await pageA.reload();
    await expect(pageA.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
    const storage = await pageA.evaluate(() => ({ ls: JSON.stringify(localStorage), ss: JSON.stringify(sessionStorage), url: location.href }));
    for (const value of Object.values(storage)) { expect(value).not.toContain(password); expect(value).not.toContain(newPassword); }
    await pageA.goto("/");
    await expect(pageA.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "个人资料", exact: true })).toBeVisible();
  } finally { await a.close(); await b.close(); }
});

test("logout goes to login and protected profile cannot be reopened", async ({ page }) => {
  await loginForProfile(page, "logout");
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?next=\/profile$/);
});

test("failed logout stays on profile and permits retry", async ({ page }) => {
  await loginForProfile(page, "logout-failure");
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 500, json: { error: "登出失败，请重试" } }));
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page.getByRole("region", { name: "登出账号", exact: true }).getByRole("alert")).toHaveText("登出失败，请重试");
  await expect(page).toHaveURL(/\/profile$/);
  expect((await page.request.get("/api/auth/me")).status()).toBe(200);
  await expect(page.getByRole("button", { name: "登出", exact: true })).toBeEnabled();
  await page.unroute("**/api/auth/logout");
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

async function revokeAccountSessions(key: string) {
  await prisma.$transaction((tx) => tx.session.updateMany({ where: { userId: account(key).id, revokedAt: null }, data: { revokedAt: new Date() } }));
}

test("expired profile session clears password inputs and offers login", async ({ page }) => {
  await loginForProfile(page, "profile-expired");
  await revokeAccountSessions("profile-expired");
  await fillPasswordChange(page, `${randomBytes(18).toString("hex")}Aa1`);
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("当前会话已失效，请重新登录后重试");
  for (const label of ["当前密码", "新密码", "确认新密码"]) await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  await page.getByRole("link", { name: "重新登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=\/profile$/);
});

test("logout with an already invalid session still takes the user to login", async ({ page }) => {
  await loginForProfile(page, "logout-expired");
  await revokeAccountSessions("logout-expired");
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("uncertain password result clears secrets and asks for logout before signing in", async ({ page }) => {
  await loginForProfile(page, "password-network");
  await page.route("**/api/users/me/password", (route) => route.abort("failed"));
  await fillPasswordChange(page, `${randomBytes(18).toString("hex")}Aa1`);
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("无法确认密码修改结果，请先登出，再重新登录确认");
  await expect(page.getByLabel("新密码", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "登出", exact: true })).toBeEnabled();
});

test("password change prevents repeated submits and concurrent logout", async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await loginForProfile(page, "password-duplicate");
  await page.route("**/api/users/me/password", async (route) => { requests += 1; await gate; await route.continue(); });
  await fillPasswordChange(page, `${randomBytes(18).toString("hex")}Aa1`);
  try {
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    await expect(page.getByRole("button", { name: "修改中…" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "登出", exact: true })).toBeDisabled();
    await page.locator("form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
    expect(requests).toBe(1);
  } finally { release(); }
  await expect(page.getByRole("status")).toHaveText("密码已更新，当前设备保持登录，其他设备需要重新登录");
});
