import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type BrowserContext } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";

const db = new PrismaClient();
const pm = "00000000-0000-4000-8000-000000000002";
let projectId: string; let a: string; let b: string; let evidence: string; let generic: string; let foreign: string; let suggestionId: string;
test.use({ channel: process.env.ACCEPTANCE_EDGE === "1" ? "msedge" : undefined });
async function identity(context: BrowserContext, baseURL: string, suffix = "2") {
  await context.addCookies([{ name: "medpm_session", value: createSessionToken(`00000000-0000-4000-8000-00000000000${suffix}`, Date.now() + 3_600_000), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}
test.beforeAll(async () => {
  await db.$transaction(async tx => {
    projectId = (await tx.project.create({ data: { name: `Synthetic task AI ${randomUUID()}`, ownerId: pm } })).id;
    await tx.projectMember.createMany({ data: ["3", "4"].map(suffix => ({ projectId, userId: `00000000-0000-4000-8000-00000000000${suffix}` })) });
    a = (await tx.task.create({ data: { projectId, title: "蓝图方案确认 A", description: "所属阶段：需求与蓝图\nSynthetic blueprint context" } })).id;
    b = (await tx.task.create({ data: { projectId, title: "业务需求调研 B", description: "所属阶段：需求与蓝图\nSynthetic research context" } })).id;
    const requirement = await tx.requirement.create({ data: { projectId, title: "Synthetic release requirement", content: "Synthetic acceptance criteria", status: "APPROVED" } });
    evidence = (await tx.task.create({ data: { projectId, title: "用户验收测试 UAT", requirementId: requirement.id } })).id;
    generic = (await tx.task.create({ data: { projectId, title: "最终用户培训" } })).id;
    const other = await tx.project.create({ data: { name: "Synthetic foreign task AI", ownerId: pm } });
    foreign = (await tx.task.create({ data: { projectId: other.id, title: "蓝图 测试" } })).id;
    // Persisted synthetic suggestions exercise the real acceptance API; no live LLM is required for UI assertions.
    for (let i = 0; i < 3; i++) {
      const suggestion = await tx.aiSuggestion.create({ data: { projectId, type: "WBS", input: { sourceTaskId: a, retrievalHitIds: [], source: "synthetic-e2e-fixture" }, output: { title: `Synthetic blueprint detail ${i}`, description: "Review synthetic deliverables and acceptance evidence", estimateHours: 4, suggestedRole: "PM", dependencyIds: [], dependencyTitles: [] } } });
      if (i === 0) suggestionId = suggestion.id;
    }
  });
});
test.afterAll(() => db.$disconnect());

test("confirmed WBS adoption reveals and highlights a task in a collapsed destination phase", async ({ page, context, baseURL }) => {
  const fixture = await db.$transaction(async tx => {
    const project = await tx.project.create({ data: { name: "Synthetic 阶段内采纳验收", ownerId: pm } });
    const parent = await tx.task.create({ data: { projectId: project.id, title: "蓝图方案确认", description: "所属阶段：需求与蓝图" } });
    await tx.task.create({ data: { projectId: project.id, title: "项目初验", description: "所属阶段：验收与运维" } });
    const suggestion = await tx.aiSuggestion.create({ data: { projectId: project.id, type: "WBS", input: { sourceTaskId: parent.id, retrievalHitIds: [], source: "synthetic-e2e-fixture" }, output: { title: "移交材料核对", description: "所属阶段：验收与运维\nSynthetic handover checklist", estimateHours: 4, suggestedRole: "PM", dependencyIds: [], dependencyTitles: [] } } });
    return { project, parent, suggestion };
  });
  await identity(context, baseURL!);
  await page.goto(`/projects/${fixture.project.id}/board`);
  const todo = page.getByRole("region", { name: "待办列", exact: true });
  const destination = todo.getByRole("button", { name: /验收与运维/ });
  await expect(destination).toHaveAttribute("aria-expanded", "false");
  await page.locator(`[data-task-card="${fixture.parent.id}"]`).getByRole("button", { name: "✨ 细化子任务", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "细化子任务", exact: true });
  await drawer.locator(`#suggestion-${fixture.suggestion.id}`).getByRole("button", { name: "采纳为任务", exact: true }).click();
  await expect(destination).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  const created = await db.task.findFirstOrThrow({ where: { projectId: fixture.project.id, title: "移交材料核对" } });
  await expect(todo.locator(`[data-task-card="${created.id}"]`)).toBeVisible();
  await expect(todo.locator(`[data-task-card="${created.id}"]`)).toBeInViewport({ ratio: 0.9 });
  await expect(page.locator(`#board-task-${created.id}`)).toHaveClass(/ring-teal-500/);
});

test("task drawer shows prompt and audit warning; real acceptance retains sourceTaskId", async ({ page, context, baseURL }) => {
  await identity(context, baseURL!);
  await page.goto(`/projects/${projectId}/board`);
  const card = page.getByRole("article").filter({ has: page.getByRole("link", { name: "蓝图方案确认 A", exact: true }) });
  const loaded = page.waitForResponse(response => response.request().method() === "GET" && response.url().includes(`/ai/wbs?sourceTaskId=${a}`));
  const detailLoaded = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/tasks/${a}`);
  await card.getByRole("button", { name: "✨ 细化子任务", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "细化子任务", exact: true });
  expect((await detailLoaded).status()).toBe(200);
  await expect(drawer.getByRole("note", { name: "AI 审计警告" })).toHaveText("AI 建议仅供辅助，采纳后将记录审计");
  await expect(drawer.getByLabel("需求描述", { exact: true })).toHaveValue(/蓝图方案确认 A.*3–5/);
  expect((await loaded).status()).toBe(200);
  await expect(drawer.getByRole("heading", { name: "Synthetic blueprint detail 0", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/task-ai-wbs-drawer.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/task-ai-wbs-narrow.png", fullPage: false });
  await page.setViewportSize({ width: 1280, height: 720 });
  const accepted = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes(`/api/ai/wbs/${suggestionId}`));
  await drawer.locator(`#suggestion-${suggestionId}`).getByRole("button", { name: "采纳为任务", exact: true }).click();
  expect((await accepted).status()).toBe(200);
  const log = await db.auditLog.findFirstOrThrow({ where: { projectId, action: "TASK_CREATED", after: { path: "$.aiSuggestionId", equals: suggestionId } } });
  expect(log.after).toMatchObject({ sourceTaskId: a });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(card).toBeFocused();
});

test("late task A response never appears in task B drawer", async ({ page, context, baseURL }) => {
  await identity(context, baseURL!);
  await page.route(`**/api/projects/${projectId}/ai/wbs*`, async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: [] } });
    await released;
    return route.fulfill({ json: { data: [{ id: randomUUID(), output: { title: "LATE_TASK_A_ONLY", description: "Synthetic", estimateHours: 1 }, history: [] }] } });
  });
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.goto(`/projects/${projectId}/board`);
  const card = (name: string) => page.getByRole("article").filter({ has: page.getByRole("link", { name, exact: true }) });
  await card("蓝图方案确认 A").getByRole("button", { name: "✨ 细化子任务", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox").check();
  const sent = page.waitForRequest(request => request.method() === "POST" && request.url().includes("/ai/wbs"));
  await page.getByRole("button", { name: "生成 WBS 建议", exact: true }).click();
  expect((await sent).postDataJSON().sourceTaskId).toBe(a);
  const aborted = page.waitForEvent("requestfailed", request => request.method() === "POST" && request.url().includes("/ai/wbs"));
  await page.keyboard.press("Escape");
  release();
  await aborted;
  const loadedB = page.waitForResponse(response => response.request().method() === "GET" && response.url().includes(`/ai/wbs?sourceTaskId=${b}`));
  await card("业务需求调研 B").getByRole("button", { name: "✨ 细化子任务", exact: true }).click();
  await loadedB;
  await expect(page.getByRole("dialog").getByLabel("需求描述", { exact: true })).toHaveValue(/业务需求调研 B/);
  await expect(page.getByText("LATE_TASK_A_ONLY", { exact: true })).toHaveCount(0);
});

test("task compliance checks only related evidence and PM cannot run global audit or review", async ({ page, context, baseURL }) => {
  test.setTimeout(90_000);
  await identity(context, baseURL!);
  expect((await page.request.post("/api/audit/summary", { data: { projectId } })).status()).toBe(403);
  await page.goto(`/projects/${projectId}/board`);
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  const card = page.getByRole("article").filter({ has: page.getByRole("link", { name: "用户验收测试 UAT", exact: true }) });
  await card.getByRole("button", { name: "🛡️ 检查合规证据", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "检查合规证据", exact: true });
  await expect(drawer.getByRole("heading", { name: "REQUIREMENT_WITHOUT_TEST", exact: true })).toBeVisible({ timeout: 65000 });
  await expect(drawer.getByRole("button", { name: "提交摘要复核", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/task-ai-compliance-drawer.png", fullPage: false });
  const summary = await db.aiSuggestion.findFirstOrThrow({ where: { projectId, type: "AUDIT_SUMMARY", input: { path: "$.filters.taskId", equals: evidence } } });
  const input = summary.input as { snapshot: { tasks: { id: string }[] }; filters: { taskId: string } };
  expect(input.snapshot.tasks.map(task => task.id)).toEqual([evidence]);
  expect((await page.request.patch(`/api/audit/summaries/${summary.id}`, { data: { decision: "ACCEPTED", note: "Synthetic forbidden" } })).status()).toBe(403);
});

test("server rejects cross-project and renamed tasks; refreshed buttons follow title and role", async ({ page, context, baseURL }) => {
  await identity(context, baseURL!);
  for (const [taskId, status] of [[foreign, 404], [generic, 400]] as const) {
    expect((await page.request.post(`/api/projects/${projectId}/ai/wbs`, { data: { sourceTaskId: taskId, request: "Synthetic task refinement request", syntheticDataConfirmed: true } })).status()).toBe(status);
    expect((await page.request.post("/api/audit/summary", { data: { projectId, taskId } })).status()).toBe(status);
  }
  await db.$transaction(tx => tx.task.update({ where: { id: b }, data: { title: "Synthetic renamed training" } }));
  await page.goto(`/projects/${projectId}/board`);
  const renamed = page.getByRole("article").filter({ has: page.getByRole("link", { name: "Synthetic renamed training", exact: true }) });
  await expect(renamed.getByRole("button", { name: "✨ 细化子任务", exact: true })).toHaveCount(0);
  expect((await page.request.post(`/api/projects/${projectId}/ai/wbs`, { data: { sourceTaskId: b, request: "Synthetic renamed task refinement", syntheticDataConfirmed: true } })).status()).toBe(400);
  await identity(context, baseURL!, "3");
  await page.reload();
  await expect(page.getByRole("button", { name: "✨ 细化子任务", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "🛡️ 检查合规证据", exact: true })).toHaveCount(0);
  expect((await page.request.post("/api/audit/summary", { data: { projectId, taskId: evidence } })).status()).toBe(403);
});
