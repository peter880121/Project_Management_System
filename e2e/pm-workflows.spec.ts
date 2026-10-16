import { expect, test, type BrowserContext } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
import { scheduleSchema } from "../src/modules/planning/schemas";

const projectId = "00000000-0000-4000-8000-000000000065";
test.use({ channel: process.env.ACCEPTANCE_EDGE === "1" ? "msedge" : undefined });
async function login(context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: "medpm_session", value: createSessionToken("00000000-0000-4000-8000-000000000002", Date.now() + 3_600_000), url: baseURL, httpOnly: true }]);
}
test.beforeEach(async ({ page, context, baseURL }) => {
  await login(context, baseURL!);
  await page.route("**/api/**", route => ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 409, json: { error: "Unmocked mutation blocked" } }));
});

test("consecutive schedule saves use each task's dates, hours, dependencies and version", async ({ page }) => {
  const tasks = [
    { id: "7766504f-dd80-4ddc-aaee-ba7e2c605c54", title: "Synthetic first task", status: "TODO", scheduleVersion: 2, plannedStartDate: "2026-10-16", dueDate: "2026-10-23", estimateHours: 8, dependencyIds: [], assignee: null },
    { id: "d77e18a4-bfb2-4d16-9e9e-2905534322a3", title: "Synthetic second task", status: "IN_PROGRESS", scheduleVersion: 0, plannedStartDate: null, dueDate: null, estimateHours: null, dependencyIds: [], assignee: null },
  ];
  const saved: unknown[] = [];
  await page.route(`**/api/projects/${projectId}/planning?*`, route => route.fulfill({ json: { data: { tasks, members: [], loads: [] } } }));
  await page.route("**/api/tasks/*/schedule", async route => {
    const body = route.request().postDataJSON();
    const parsed = scheduleSchema.safeParse(body);
    if (!parsed.success) return route.fulfill({ status: 400, json: { error: "排期参数无效", issues: parsed.error.issues } });
    saved.push(body);
    const task = tasks.find(task => route.request().url().includes(task.id))!;
    Object.assign(task, parsed.data);
    task.scheduleVersion++;
    await route.fulfill({ json: { data: { id: task.id, scheduleVersion: task.scheduleVersion } } });
  });
  await page.goto(`/projects/${projectId}/planning`);
  const first = page.locator("article").filter({ has: page.getByRole("link", { name: tasks[0].title, exact: true }) });
  const second = page.locator("article").filter({ has: page.getByRole("link", { name: tasks[1].title, exact: true }) });
  await first.getByRole("button", { name: "保存排期", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  await expect(second.getByRole("button", { name: "保存排期", exact: true })).toBeEnabled();
  await second.getByLabel(`开始日期 ${tasks[1].title}`, { exact: true }).fill("2026-10-16");
  await second.getByLabel(`截止日期 ${tasks[1].title}`, { exact: true }).fill("2026-10-21");
  await second.getByLabel(`预计工时 ${tasks[1].title}`, { exact: true }).fill("8");
  await second.getByRole("button", { name: "保存排期", exact: true }).click();
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[1]).toMatchObject({ expectedVersion: 0, plannedStartDate: "2026-10-16", dueDate: "2026-10-21", estimateHours: 8, dependencyIds: [] });
  await page.screenshot({ path: "test-results/pm-planning-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/pm-planning-mobile.png", fullPage: true });
});

test("project overview emphasizes status and project creation returns with explicit success", async ({ page }) => {
  await page.route("**/api/projects", route => route.request().method() === "POST" ? route.fulfill({ status: 201, json: { data: { id: projectId } } }) : route.continue());
  await page.goto("/projects");
  await expect(page.getByRole("region", { name: "项目状态概览", exact: true })).toBeVisible();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/pm-projects-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await page.getByLabel("项目名称", { exact: true }).fill("Synthetic isolated UI project");
  await page.getByLabel("项目描述", { exact: true }).fill("Synthetic UI request; persistence mocked");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "项目列表已更新" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Atlas Release Readiness", exact: true })).toBeVisible();
});

test("task creation is separate and returns to the status board with the new task", async ({ page }) => {
  const task = { id: "00000000-0000-4000-8000-000000000999", title: "Synthetic new task", description: null, status: "TODO", assigneeId: null, assignee: null, requirement: null };
  let created = false;
  await page.route(`**/api/projects/${projectId}/tasks`, async route => {
    if (route.request().method() === "POST") { created = true; return route.fulfill({ status: 201, json: { data: task } }); }
    return route.fulfill({ json: { data: created ? [task] : [] } });
  });
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByRole("region", { name: "任务状态概览", exact: true })).toBeVisible();
  await expect(page.getByLabel("任务标题", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "WBS 分解 Agent", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "创建任务", exact: true }).click();
  await page.getByLabel("任务标题", { exact: true }).fill(task.title);
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "创建成功" })).toBeVisible();
  await expect(page.getByRole("link", { name: task.title, exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/pm-task-board.png", fullPage: true });
});

test("failed WBS generation preserves the request and separates failure from retrieval fallback", async ({ page }) => {
  const message = "AI 返回的任务结构未通过校验，请缩小拆解范围后重试。";
  await page.route(`**/api/projects/${projectId}/ai/wbs`, route => route.fulfill({ json: route.request().method() === "POST" ? { data: [], manualFallback: true, degraded: true, failureCode: "MODEL_RESPONSE_INVALID", message } : { data: [] } }));
  await page.goto(`/projects/${projectId}/wbs`);
  const request = page.getByLabel("需求描述", { exact: true });
  await request.fill("Synthetic login delivery acceptance with validation and audit evidence");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "生成 WBS 建议", exact: true }).click();
  await expect(page.getByRole("region", { name: "WBS 分解 Agent", exact: true }).getByRole("alert")).toContainText(message);
  await expect(request).toHaveValue("Synthetic login delivery acceptance with validation and audit evidence");
  await expect(page.getByRole("link", { name: "手动创建任务", exact: true })).toHaveAttribute("href", `/projects/${projectId}/tasks/new`);
  await expect(page.getByText("部分证据通过关键词检索获得，请人工核对来源。", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/pm-wbs-failure.png", fullPage: true });
});
