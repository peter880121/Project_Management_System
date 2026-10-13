import { expect, test } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";

const pmId = "00000000-0000-4000-8000-000000000002";
const projectId = "00000000-0000-4000-8000-000000000065";
const requirementId = "00000000-0000-4000-8000-0000000000c9";
const secret = process.env.SESSION_SECRET || "e2e-only-secret-not-for-production-00000000";

test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const token = createSessionToken(pmId, Date.now() + 60 * 60 * 1000, secret);
  await context.addCookies([{ name: "medpm_session", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
});

test("PM creates a task, changes its status, and reviews requirement and audit history", async ({ page }) => {
  const title = `E2E task ${Date.now()}`;
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByRole("heading", { name: "Atlas Release Readiness" })).toBeVisible();
  await page.getByLabel("任务标题").fill(title);
  await page.getByLabel("关联需求").selectOption(requirementId);
  await page.getByRole("button", { name: "创建任务" }).click();
  const task = page.getByRole("link", { name: title });
  await expect(task).toBeVisible({ timeout: 20_000 });
  const taskCard = page.locator("article").filter({ has: task });
  await taskCard.getByRole("button", { name: "开始 / 恢复" }).click();
  await expect(page.getByRole("status")).toContainText("审计时间线");
  const taskUrl = new URL((await task.getAttribute("href"))!, page.url()).toString();
  await page.goto(taskUrl);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Atlas synthetic requirement 1")).toBeVisible();
  await expect(page.getByText("Verify synthetic requirement 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "审计时间线" })).toBeVisible();
  await expect(page.getByText("TASK_CREATED")).toBeVisible();
  await expect(page.getByText("TASK_STATUS_CHANGED")).toBeVisible();
});
