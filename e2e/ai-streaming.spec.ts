import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";

test.skip(!process.env.AI_STREAM_FIXTURE_URL, "Run scripts/test-ai-streaming-e2e.mjs for the explicit model protocol fixture");
test.use({ trace: "off" });
const db = new PrismaClient(); const run = randomUUID(); const email = `stream-${run}@medpm.local`;
const evidence = "test-results/ai-streaming-evidence";
let password: string; let actorId: string; let projectId: string; let taskId: string; let complianceId: string;
const control = (mode: string) => fetch(`${process.env.AI_STREAM_FIXTURE_URL}/__fixture/control?mode=${mode}`, { method: "POST" }).then(response => response.json()) as Promise<{ started: number; cancelled: number }>;
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || ""; if (!password) throw new Error("Seed password required");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => {
    actorId = (await tx.user.create({ data: { email, name: "Synthetic streaming PM", role: "PM", status: "ACTIVE", passwordHash } })).id;
    projectId = (await tx.project.create({ data: { name: "任务级 AI 流式验收（合成模型协议）", ownerId: actorId } })).id;
    taskId = (await tx.task.create({ data: { projectId, title: "蓝图方案确认" } })).id;
    complianceId = (await tx.task.create({ data: { projectId, title: "用户验收测试 UAT" } })).id;
  });
  await mkdir(evidence, { recursive: true });
});
test.beforeEach(async ({ page }) => {
  await db.$transaction(tx => tx.user.update({ where: { id: actorId }, data: { role: "PM" } }));
  expect((await page.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  await control("normal");
});
test.afterAll(async () => { try { await db.$transaction(tx => tx.session.deleteMany({ where: { userId: actorId } })); } finally { await db.$disconnect(); } });
async function startWbs(page: Page) {
  await page.goto(`/projects/${projectId}/board`);
  await page.locator(`[data-task-card="${taskId}"]`).getByRole("button", { name: "✨ 细化子任务", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "细化子任务", exact: true });
  await drawer.getByRole("checkbox").check(); await drawer.getByRole("button", { name: "生成 WBS 建议", exact: true }).click();
  return drawer;
}
test("real SSE shows progressive text and saves validated pending cards", async ({ page }) => {
  test.setTimeout(90000);
  const drawer = await startWbs(page); const preview = drawer.getByRole("region", { name: "AI 流式生成预览" });
  await expect(preview.getByText(/正在核对当前任务的交付/)).toBeVisible();
  await expect(preview.getByRole("button", { name: "停止生成" })).toBeVisible();
  const before = await preview.locator("p").nth(1).textContent();
  await expect.poll(() => preview.locator("p").nth(1).textContent()).not.toBe(before);
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/01-streaming-preview.png`, fullPage: true });
  await expect(drawer.getByRole("heading", { name: "确认交付范围", exact: true })).toBeVisible({ timeout: 45000 });
  await expect(drawer.getByRole("button", { name: "停止生成" })).toHaveCount(0);
  expect(await db.aiSuggestion.count({ where: { projectId, type: "WBS", status: "PENDING" } })).toBe(3);
  expect(await db.task.count({ where: { projectId } })).toBe(2);
  await drawer.getByRole("heading", { name: "待确认任务（可逐条采纳）" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/03-streamed-pending-cards.png`, fullPage: true });
});
test("stop and drawer close abort the provider and clear queued animation", async ({ page }) => {
  test.setTimeout(90000); const baseline = await control("hold");
  const count = await db.aiSuggestion.count({ where: { projectId, type: "WBS" } });
  const drawer = await startWbs(page); const preview = drawer.getByRole("region", { name: "AI 流式生成预览" });
  await expect(preview.getByText(/正在核对当前任务的交付/)).toBeVisible();
  await preview.getByRole("button", { name: "停止生成" }).click();
  const frozen = await preview.locator("p").nth(1).textContent();
  await expect.poll(async () => (await control("hold")).cancelled).toBeGreaterThan(baseline.cancelled);
  expect(await preview.locator("p").nth(1).textContent()).toBe(frozen);
  expect(await db.aiSuggestion.count({ where: { projectId, type: "WBS" } })).toBe(count);
  const again = await control("hold"); await drawer.getByRole("button", { name: "生成 WBS 建议", exact: true }).click();
  await expect.poll(async () => (await control("hold")).started).toBeGreaterThan(again.started);
  await page.keyboard.press("Escape"); await expect(drawer).toHaveCount(0);
  await expect.poll(async () => (await control("hold")).cancelled).toBeGreaterThan(again.cancelled);
  await expect(page.getByRole("region", { name: "AI 流式生成预览" })).toHaveCount(0);
});
test("mid-stream role revocation emits UNAUTHORIZED, refreshes the session and shows a toast", async ({ page }) => {
  test.setTimeout(90000); await control("hold");
  const count = await db.aiSuggestion.count({ where: { projectId } });
  const drawer = await startWbs(page);
  await expect(drawer.getByText(/正在核对当前任务的交付/)).toBeVisible();
  await db.$transaction(tx => tx.user.update({ where: { id: actorId }, data: { role: "MEMBER" } }));
  const refreshedSession = page.waitForResponse(response => response.url().endsWith("/api/auth/me"));
  await control("release");
  expect((await refreshedSession).status()).toBe(200);
  await expect(page.getByRole("alert").filter({ hasText: "权限或会话已变化，已停止生成" }).first()).toBeVisible();
  await page.screenshot({ path: `${evidence}/02-stream-unauthorized-toast.png`, fullPage: true });
  expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(count);
});
test("task compliance streams to a persisted pending conclusion", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto(`/projects/${projectId}/board`);
  await page.locator(`[data-task-card="${complianceId}"]`).getByRole("button", { name: "🛡️ 检查合规证据", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "检查合规证据", exact: true });
  await expect(drawer.getByRole("button", { name: "停止生成" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "合规审计摘要 · PENDING", exact: true })).toBeVisible({ timeout: 45000 });
  expect(await db.aiSuggestion.count({ where: { projectId, type: "AUDIT_SUMMARY", status: "PENDING" } })).toBe(1);
});

test("correction progress is visible and only clean pending suggestions are committed", async ({ page }) => {
  test.setTimeout(90000); await control("dirty-retry");
  const existing = await db.aiSuggestion.findMany({ where: { projectId }, select: { id: true } });
  const drawer = await startWbs(page);
  const preview = drawer.getByRole("region", { name: "AI 流式生成预览" });
  await expect(preview.getByText("正在重试…", { exact: true })).toBeVisible({ timeout: 45000 });
  await expect(preview.getByText(/输出格式校验未通过，正在自动修正/)).toBeVisible();
  await expect(preview).not.toContainText(/PUBLIC_PREVIEW|internal|synthetic-private-content/);
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/05-retrying-clean-preview.png`, fullPage: true });
  await control("release");
  await expect(drawer.getByRole("status").filter({ hasText: "建议已生成并保存为待确认项目" })).toBeVisible({ timeout: 45000 });
  const rows = await db.aiSuggestion.findMany({ where: { projectId, id: { notIn: existing.map(row => row.id) } }, select: { id: true, status: true, input: true, output: true } });
  expect(rows).toHaveLength(3);
  expect(rows.every(row => row.status === "PENDING")).toBe(true);
  expect(JSON.stringify(rows)).not.toMatch(/PUBLIC_PREVIEW|internal|synthetic-private-content/);
  expect(await db.task.count({ where: { projectId } })).toBe(2);
  await writeFile(`${evidence}/clean-persisted-suggestions.json`, JSON.stringify(rows, null, 2));
  await drawer.locator(`#suggestion-${rows.find(row => (row.output as { title?: string }).title === "确认交付范围")!.id}`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/06-corrected-clean-cards.png`, fullPage: true });
});

for (const attempt of [1, 2]) test(`stopping correction ${attempt} aborts the provider without partial records`, async ({ page }) => {
  test.setTimeout(90000); const mode = `retry-hold-${attempt}`; const baseline = await control(mode);
  const count = await db.aiSuggestion.count({ where: { projectId } });
  const drawer = await startWbs(page); const preview = drawer.getByRole("region", { name: "AI 流式生成预览" });
  await expect(preview.getByText(new RegExp(`第 ${attempt}/2 次`))).toBeVisible({ timeout: 45000 });
  await expect.poll(async () => (await control(mode)).started).toBe(baseline.started + attempt + 1);
  await preview.getByRole("button", { name: "停止生成" }).click();
  const frozen = await preview.locator("p").nth(1).textContent();
  await expect.poll(async () => (await control(mode)).cancelled).toBeGreaterThan(baseline.cancelled);
  expect(await preview.locator("p").nth(1).textContent()).toBe(frozen);
  expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(count);
});

test("two failed corrections return the friendly fallback without saving suggestions", async ({ page }) => {
  test.setTimeout(90000); const baseline = await control("invalid");
  const count = await db.aiSuggestion.count({ where: { projectId } });
  const drawer = await startWbs(page);
  await expect(page.getByRole("alert").filter({ hasText: "当前需求描述可能过于复杂，AI 未能生成标准结构，请精简描述或手动创建。" }).first()).toBeVisible({ timeout: 45000 });
  await expect(drawer.getByRole("button", { name: "停止生成" })).toHaveCount(0);
  expect((await control("invalid")).started).toBe(baseline.started + 3);
  expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(count);
});
