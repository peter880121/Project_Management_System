// Prerequisites: run `pnpm db:seed` first, and set LOCAL_DEV_SEED_PASSWORD to the same value used by that seed.
import { expect, test } from "@playwright/test";

const projectId = "00000000-0000-4000-8000-000000000065";
const requirementId = "00000000-0000-4000-8000-0000000000c9";

test.beforeEach(async ({ page, baseURL }) => {
  const password = process.env.LOCAL_DEV_SEED_PASSWORD;
  if (!password) {
    throw new Error("E2E 环境变量缺失：请设置 LOCAL_DEV_SEED_PASSWORD，且其值必须与运行 pnpm db:seed 时一致。");
  }
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const response = await page.request.post(new URL("/api/auth/login", baseURL).toString(), {
    data: { email: "pm@medpm.local", password },
  });
  if (!response.ok()) {
    const responseBody = await response.text();
    throw new Error(`E2E 登录失败：HTTP ${response.status()}，响应：${responseBody}`);
  }
});

test("PM creates a task, changes its status, and reviews requirement and audit history", async ({ page }) => {
  // Creation, assignment, state change and detail navigation exhausted 30s before page.goto completed.
  test.setTimeout(90_000);
  const title = `E2E task ${Date.now()}`;
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByRole("heading", { name: "Atlas Release Readiness" })).toBeVisible();
  await page.getByRole("link", { name: "创建任务", exact: true }).click();
  await page.getByLabel("任务标题").fill(title);
  await page.getByLabel("关联需求").selectOption(requirementId);
  await page.getByRole("button", { name: "创建任务" }).click();
  const task = page.getByRole("link", { name: title });
  await expect(task).toBeVisible({ timeout: 20_000 });
  const taskCard = page.locator("article").filter({ has: task });
  const assignee = taskCard.getByRole("combobox", { name: `分配 ${title}` });
  await expect(assignee.locator('option[value="00000000-0000-4000-8000-000000000003"]')).toHaveCount(1);
  await assignee.selectOption("00000000-0000-4000-8000-000000000003");
  await expect(taskCard.getByText("负责人：Synthetic Engineer", { exact: true })).toBeVisible();
  await taskCard.getByRole("button", { name: "开始 / 恢复" }).click();
  await expect(page.getByRole("status").filter({ hasText: "审计时间线" })).toBeVisible();
  const taskUrl = new URL((await task.getAttribute("href"))!, page.url()).toString();
  await page.goto(taskUrl);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Atlas synthetic requirement 1")).toBeVisible();
  await expect(page.getByText("Verify synthetic requirement 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "审计时间线" })).toBeVisible();
  await expect(page.getByText("TASK_CREATED")).toBeVisible();
  await expect(page.getByText("TASK_STATUS_CHANGED")).toBeVisible();
  await expect(page.getByText("TASK_ASSIGNED")).toBeVisible();
});
