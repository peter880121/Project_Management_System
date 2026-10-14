import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const runId = randomUUID();
const accounts = new Map<string, { id: string; email: string }>();
const accountIds: string[] = [];
let password: string;

test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || "";
  if (!password) throw new Error("Set LOCAL_DEV_SEED_PASSWORD before running auth E2E.");
  const passwordHash = await hashPassword(password);
  // Each test gets a distinct ACTIVE MEMBER; no shared seed account is modified.
  for (const key of ["home", "next", "unsafe", "authenticated", "invalid", "pending", "locked", "duplicate", "network"]) {
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
    const where = { userId: { in: accountIds }, user: { email: { endsWith: "@medpm.local" } } };
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
