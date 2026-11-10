import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";

const db = new PrismaClient();
let projectId: string; let taskId: string;
test.use({ trace: "off", channel: process.env.ACCEPTANCE_EDGE === "1" ? "msedge" : undefined });
test.beforeAll(async ({ request }) => {
  const cookie = `medpm_session=${createSessionToken("00000000-0000-4000-8000-000000000002", Date.now() + 3_600_000)}`;
  const response = await request.post("/api/projects", { headers: { cookie }, data: { name: "Synthetic 医疗软件交付看板" } });
  expect(response.status()).toBe(201); projectId = (await response.json()).data.id;
  await db.$transaction(tx => tx.projectMember.create({ data: { projectId, userId: "00000000-0000-4000-8000-000000000003" } }));
  taskId = (await db.task.findFirstOrThrow({ where: { projectId, title: "召开项目启动会" } })).id;
});
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "medpm_session", value: createSessionToken("00000000-0000-4000-8000-000000000002", Date.now() + 3_600_000), url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
});
test.afterAll(() => db.$disconnect());

test("compact header removes duplicate counts, enlarges return and keeps the more menu keyboard accessible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const from = "/projects?view=all&q=Synthetic&sort=name_asc&page=2";
  await page.goto(`/projects/${projectId}/board?${new URLSearchParams({ returnTo: from })}`);
  await expect(page.getByRole("link", { name: "召开项目启动会", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "任务状态概览", exact: true })).toHaveCount(0);
  const back = page.getByRole("link", { name: "返回项目看板", exact: true }); await expect(back).toHaveAttribute("href", from); expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  const nav = page.getByRole("navigation", { name: "项目功能", exact: true }); await expect(nav.getByRole("link")).toHaveCount(5); await expect(nav.getByRole("link", { name: "任务看板", exact: true })).toHaveAttribute("aria-current", "page");
  const trigger = page.getByRole("button", { name: "更多项目功能", exact: true }); const menu = page.getByRole("menu", { name: "更多项目功能", exact: true });
  await trigger.focus(); await page.keyboard.press("ArrowDown"); await expect(menu.getByRole("menuitem").first()).toBeFocused(); await expect(menu.getByRole("menuitem", { name: "智能 WBS 分解", exact: true })).toBeVisible(); await expect(menu.getByRole("menuitem", { name: "合规导出", exact: true })).toHaveCount(0);
  await page.keyboard.press("End"); await expect(menu.getByRole("menuitem").last()).toBeFocused(); await page.keyboard.press("Home"); await expect(menu.getByRole("menuitem").first()).toBeFocused(); await page.keyboard.press("Escape"); await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click(); await page.keyboard.press("Tab"); await expect(menu).toHaveCount(0); await expect(trigger).not.toBeFocused();
  await trigger.click(); await page.getByRole("heading", { level: 1 }).click(); await expect(menu).toHaveCount(0);
  if (process.env.E2E_CAPTURE_BOARD_HEADER === "1") await page.screenshot({ path: "test-results/board-refined-header.png" });
  await page.setViewportSize({ width: 390, height: 844 }); await trigger.click(); await expect(menu.getByRole("menuitem", { name: "项目成员", exact: true })).toBeVisible();
  const bounds = await menu.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await menu.getByRole("menuitem", { name: "项目成员", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/members$`));
});

test("more menu preserves role-specific destinations without offering management actions to members", async ({ page, context, baseURL }) => {
  const qa = await db.user.findFirstOrThrow({ where: { role: "QA", status: "ACTIVE" }, select: { id: true } });
  await db.$transaction(tx => tx.projectMember.upsert({ where: { projectId_userId: { projectId, userId: qa.id } }, create: { projectId, userId: qa.id }, update: { active: true } }));
  for (const [id, role] of [["00000000-0000-4000-8000-000000000003", "MEMBER"], [qa.id, "QA"], ["00000000-0000-4000-8000-000000000001", "ADMIN"]]) {
    await context.addCookies([{ name: "medpm_session", value: createSessionToken(id, Date.now() + 3600000), url: baseURL!, httpOnly: true }]); await page.goto(`/projects/${projectId}/board`);
    if (role !== "ADMIN") await expect(page.getByRole("link", { name: "创建任务", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "更多项目功能", exact: true }).click(); const menu = page.getByRole("menu", { name: "更多项目功能", exact: true });
    await expect(menu.getByRole("menuitem", { name: "智能 WBS 分解", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "合规导出", exact: true })).toHaveCount(role === "MEMBER" ? 0 : 1); await page.keyboard.press("Escape");
  }
});

test("four aligned columns scroll independently; mobile pans horizontally without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByRole("link", { name: "召开项目启动会", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  const todo = page.getByRole("region", { name: "待办列", exact: true });
  await expect(todo.getByRole("button", { name: /项目启动/ })).toHaveAttribute("aria-expanded", "true");
  await expect(todo.getByRole("button", { name: /需求与蓝图/ })).toHaveAttribute("aria-expanded", "false");
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/ia-board-collapsed.png" });
  while (await todo.getByRole("button", { expanded: false }).count()) await todo.getByRole("button", { expanded: false }).first().click();
  await expect(page.getByRole("article")).toHaveCount(14);
  const board = page.getByRole("region", { name: "任务看板", exact: true });
  const geometry = await board.evaluate(element => Array.from(element.children).map(column => column.getBoundingClientRect().toJSON()));
  expect(new Set(geometry.map(rect => rect.y)).size).toBe(1);
  expect(new Set(geometry.map(rect => rect.height)).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  const list = page.locator('[aria-label="待办任务列表"]');
  expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const headingY = (await page.getByRole("heading", { level: 1 }).boundingBox())!.y;
  await list.evaluate(element => { element.scrollTop = 200; });
  expect((await page.getByRole("heading", { level: 1 }).boundingBox())!.y).toBe(headingY);
  await list.evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByRole("article").first().getByRole("combobox")).toHaveCount(0);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/board-compact-desktop.png" });
  // Show a real occupied neighboring lane in the horizontal-scroll screenshot.
  const neighboringTask = await db.task.findFirstOrThrow({ where: { projectId, title: "系统正式切换上线" } });
  expect((await page.request.patch(`/api/tasks/${neighboringTask.id}`, { data: { status: "IN_PROGRESS" } })).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("region", { name: "进行中列", exact: true }).locator(`[data-task-card="${neighboringTask.id}"]`)).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await board.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/board-compact-narrow-start.png" });
  await board.evaluate(element => { element.scrollLeft = 200; });
  expect(await board.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/board-compact-narrow.png" });
});

test("returning a task to a collapsed phase expands its destination and highlights it", async ({ page }) => {
  expect((await page.request.patch(`/api/tasks/${taskId}`, { data: { status: "IN_PROGRESS" } })).status()).toBe(200);
  await page.goto(`/projects/${projectId}/board`);
  const todo = page.getByRole("region", { name: "待办列", exact: true });
  const toggle = todo.getByRole("button", { name: /项目启动/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await page.getByRole("region", { name: "进行中列", exact: true }).locator(`[data-task-card="${taskId}"]`).getByRole("button", { name: "退回待办", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(todo.locator(`[data-task-card="${taskId}"]`)).toBeVisible();
  await expect(page.locator(`#board-task-${taskId}`)).toHaveClass(/ring-teal-500/);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/ia-board-moved-highlight.png" });
});

test("detail remains open and refreshes both assignment and state; icons do not bubble", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${projectId}/board`);
  const card = page.locator(`[data-task-card="${taskId}"]`);
  const detailLoaded = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/tasks/${taskId}`);
  await card.getByRole("button", { name: "负责人：未分配", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "任务详情", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect((await detailLoaded).status()).toBe(200);
  const assignee = drawer.getByRole("combobox", { name: "分配 召开项目启动会", exact: true });
  await expect(assignee).toBeEnabled();
  await assignee.selectOption("00000000-0000-4000-8000-000000000003");
  await expect(assignee).toHaveValue("00000000-0000-4000-8000-000000000003");
  await expect(card.getByRole("button", { name: "负责人：Synthetic Engineer", exact: true })).toHaveCount(1);
  await drawer.getByRole("button", { name: "开始 / 恢复", exact: true }).click();
  await expect(drawer.getByText("进行中", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "进行中列", exact: true }).locator(`[data-task-card="${taskId}"]`)).toHaveCount(1);
  await expect(drawer.getByRole("status").filter({ hasText: "更新已保存" }).first()).toBeVisible();
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/board-task-detail-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(Math.round((await drawer.boundingBox())!.width)).toBe(390);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/board-task-detail-narrow.png" });
  const completed = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/tasks/${taskId}`);
  const refreshed = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/tasks/${taskId}`);
  await drawer.getByRole("button", { name: "完成", exact: true }).click();
  const signature = page.getByRole("dialog", { name: "电子签名", exact: true });
  await signature.getByLabel("签名实际工时").fill("4");
  await signature.getByLabel("签名密码", { exact: true }).fill(process.env.LOCAL_DEV_SEED_PASSWORD!);
  await signature.getByRole("button", { name: "确认签署", exact: true }).click();
  expect((await completed).status()).toBe(200);
  expect((await refreshed).status()).toBe(200);
  await expect(drawer.getByText("已完成", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // A card status icon updates the column directly and never opens the drawer.
  await page.setViewportSize({ width: 1440, height: 900 });
  page.once("dialog", dialog => dialog.accept());
  await card.getByRole("button", { name: "重新打开", exact: true }).click();
  await expect(page.getByRole("region", { name: "进行中列", exact: true }).locator(`[data-task-card="${taskId}"]`)).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("skeletons precede data; failed saves retain drawer and input with an error toast", async ({ page }) => {
  const current = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (current.status !== "IN_PROGRESS") expect((await page.request.patch(`/api/tasks/${taskId}`, { data: { status: "IN_PROGRESS" } })).status()).toBe(200);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${projectId}/tasks`, async route => { await held; await route.continue(); });
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.getByRole("status", { name: "正在加载看板任务", exact: true })).toHaveCount(4);
  release();
  await expect(page.locator(`[data-task-card="${taskId}"]`)).toBeVisible();
  let detailRelease!: () => void;
  const detailHeld = new Promise<void>(resolve => { detailRelease = resolve; });
  await page.route(`**/api/tasks/${taskId}`, async route => {
    if (route.request().method() === "PATCH") return route.fulfill({ status: 503, json: { error: "Synthetic update failure" } });
    await detailHeld; await route.continue();
  });
  await page.locator(`[data-task-card="${taskId}"]`).click();
  await expect(page.getByRole("status", { name: "正在加载任务详情", exact: true })).toBeVisible();
  detailRelease();
  const drawer = page.getByRole("dialog", { name: "任务详情", exact: true });
  await drawer.getByRole("button", { name: "完成", exact: true }).click();
  const signature = page.getByRole("dialog", { name: "电子签名", exact: true });
  const hours = signature.getByLabel("签名实际工时");
  await hours.fill("6");
  await signature.getByLabel("签名密码", { exact: true }).fill(process.env.LOCAL_DEV_SEED_PASSWORD!);
  await signature.getByRole("button", { name: "确认签署", exact: true }).click();
  await expect(signature.getByRole("alert").filter({ hasText: "Synthetic update failure" }).first()).toBeVisible();
  await expect(hours).toHaveValue("6");
  await expect(signature).toBeVisible();
});

test("late detail responses cannot overwrite a different task and small pointer drags do not open cards", async ({ page }) => {
  const other = await db.task.findFirstOrThrow({ where: { projectId, title: "制定实施主计划" } });
  let release!: () => void; let completed!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const handled = new Promise<void>(resolve => { completed = resolve; });
  await page.route(`**/api/tasks/${taskId}`, async route => {
    await held;
    try { await route.fulfill({ json: { data: { id: taskId, title: "LATE_TASK_A_DETAIL" } } }); } finally { completed(); }
  });
  await page.goto(`/projects/${projectId}/board`);
  const first = page.locator(`[data-task-card="${taskId}"]`);
  await first.click();
  await expect(page.getByRole("status", { name: "正在加载任务详情", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const second = page.locator(`[data-task-card="${other.id}"]`);
  await second.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: other.title, exact: true })).toBeVisible();
  release(); await handled;
  await expect(page.getByRole("dialog").getByRole("heading", { name: other.title, exact: true })).toBeVisible();
  await expect(page.getByText("LATE_TASK_A_DETAIL", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const box = (await second.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down(); await page.mouse.move(box.x + 20, box.y + 10); await page.mouse.up();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
