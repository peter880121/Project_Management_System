import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";
test.skip(!process.env.AI_STREAM_FIXTURE_URL, "Requires the isolated LangChain HTTP streaming fixture");
test.use({ trace: "off", viewport: { width: 1440, height: 1100 } });
const db = new PrismaClient(); const email = `meeting-ai-${randomUUID()}@medpm.local`; const evidence = "test-results/meeting-ai-evidence";
let password: string, actorId: string, projectId: string, meetingId: string, zhangId: string;
const control = (mode: string) => fetch(`${process.env.AI_STREAM_FIXTURE_URL}/__fixture/control?mode=${mode}`, { method: "POST" }).then(res => res.json()) as Promise<{ started: number; cancelled: number }>;
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || ""; if (!password) throw new Error("Synthetic seed password required");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => {
    actorId = (await tx.user.create({ data: { email, name: "合成会议 PM", role: "PM", status: "ACTIVE", passwordHash } })).id;
    projectId = (await tx.project.create({ data: { name: "AI 会议提炼与行动闭环（合成数据）", ownerId: actorId } })).id;
    zhangId = (await tx.user.create({ data: { email: `zhang-${randomUUID()}@medpm.local`, name: "张明 · 接口工程师", role: "MEMBER", status: "ACTIVE" } })).id;
    const li = await tx.user.create({ data: { email: `li-${randomUUID()}@medpm.local`, name: "李华 · 测试工程师", role: "MEMBER", status: "ACTIVE" } });
    await tx.projectMember.createMany({ data: [{ projectId, userId: zhangId }, { projectId, userId: li.id }] });
  }); await mkdir(evidence, { recursive: true });
});
test.beforeEach(async ({ page }) => {
  await db.$transaction(async tx => {
    await tx.user.update({ where: { id: actorId }, data: { role: "PM" } });
    meetingId = (await tx.meetingRecord.create({ data: { projectId, title: "接口联调与验收工作会议", content: "待整理的合成会议记录", meetingDate: new Date("2026-10-19T02:00:00Z"), actionItems: [], visibleRoles: ["PM"], status: "DRAFT", createdById: actorId, requestKey: randomUUID() } })).id;
  });
  expect((await page.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200); await control("normal");
});
test.afterAll(async () => { try { await db.$transaction(tx => tx.session.deleteMany({ where: { userId: actorId } })); } finally { await db.$disconnect(); } });
async function open(page: Page) {
  await page.goto(`/projects/${projectId}/meetings`);
  await page.locator(`[data-meeting-id="${meetingId}"]`).click();
  return page.getByRole("region", { name: "AI 会议提炼", exact: true });
}
async function generate(page: Page) {
  const panel = await open(page); await panel.getByLabel("会议转写稿", { exact: true }).fill("本次合成会议明确接口联调范围。张工下周一完成联调计划，另需整理验收证据清单，待 PM 确认。");
  await panel.getByRole("checkbox").check(); await panel.getByRole("button", { name: "AI 提炼纪要", exact: true }).click(); return panel;
}
test("real SSE, fuzzy member match, atomic task conversion and global board/Gantt refresh", async ({ page, context }) => {
  test.setTimeout(120000);
  const board = await context.newPage(); await board.goto(`/projects/${projectId}/board`);
  const gantt = await context.newPage(); await gantt.goto(`/projects/${projectId}/planning`);
  const panel = await generate(page); const preview = panel.getByLabel("AI 摘要预览", { exact: true });
  await expect(preview.getByText(/会议确认了接口联调/)).toBeVisible({ timeout: 20000 }); await expect(panel.getByRole("button", { name: "停止生成" })).toBeVisible();
  const before = await preview.locator("p").last().textContent(); await expect.poll(() => preview.locator("p").last().textContent()).not.toBe(before);
  await panel.scrollIntoViewIfNeeded(); if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/01-streaming-typewriter.png`, fullPage: true });
  const card = panel.getByRole("article", { name: "行动项：完成接口联调计划", exact: true }); await expect(card).toBeVisible({ timeout: 45000 });
  const pending = await db.aiSuggestion.findFirstOrThrow({ where: { projectId, type: "MEETING_SUMMARY", input: { path: "$.meetingId", equals: meetingId } } }); expect(pending.status).toBe("PENDING");
  expect(await db.task.count({ where: { projectId } })).toBe(0);
  await card.scrollIntoViewIfNeeded(); if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/02-action-item-cards.png`, fullPage: true });
  await card.getByRole("button", { name: "转为任务", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "行动项转为任务", exact: true });
  await expect(dialog.getByLabel("搜索负责人", { exact: true })).toHaveValue("张"); await expect(dialog.getByLabel("负责人", { exact: true }).getByRole("option")).toHaveCount(2);
  await expect(dialog.getByLabel("负责人", { exact: true }).getByRole("option", { name: "张明 · 接口工程师" })).toHaveCount(1);
  await dialog.getByLabel("负责人", { exact: true }).selectOption(zhangId);
  await dialog.getByLabel("预计工时", { exact: true }).fill("4");
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/03-fuzzy-assignee-dialog.png`, fullPage: false });
  await dialog.getByRole("checkbox").check();
  const boardRefresh = board.waitForResponse(res => res.url().endsWith(`/api/projects/${projectId}/tasks`) && res.status() === 200);
  const planningRefresh = gantt.waitForResponse(res => res.url().includes(`/api/projects/${projectId}/planning?`) && res.status() === 200);
  const created = page.waitForResponse(res => res.request().method() === "POST" && new URL(res.url()).pathname === `/api/projects/${projectId}/tasks`);
  await dialog.getByRole("button", { name: "确认创建任务", exact: true }).click(); expect((await created).status()).toBe(201);
  await expect(page.getByRole("status").filter({ hasText: "行动项已转为任务" })).toBeVisible(); await expect(card.getByRole("link", { name: /已转任务/ })).toBeVisible(); await expect(page.getByRole("region", { name: "AI 会议提炼", exact: true })).toHaveCount(1); await expect(dialog).toHaveCount(0); await Promise.all([boardRefresh, planningRefresh]);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/04-converted-task-toast.png`, fullPage: true });
  const task = await db.task.findFirstOrThrow({ where: { projectId, title: "完成接口联调计划" } }); expect(task.assigneeId).toBe(zhangId);
  const meeting = await db.meetingRecord.findUniqueOrThrow({ where: { id: meetingId } }); expect(JSON.stringify(meeting.actionItems)).toContain(task.id);
  await page.getByRole("link", { name: "去看看任务" }).click(); await expect(page.getByRole("dialog", { name: "任务详情", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "任务详情", exact: true })).toContainText("完成接口联调计划"); await board.close(); await gantt.close();
});
test("draft creation, explicit adoption and finalization keep the final content readonly", async ({ page }) => {
  test.setTimeout(90000); const initialTaskCount = await db.task.count({ where: { projectId } }); await page.goto(`/projects/${projectId}/meetings`);
  const form = page.getByRole("form", { name: "创建会议纪要" }); await form.getByLabel("会议标题", { exact: true }).fill("新的合成会议草稿"); await form.getByLabel("会议时间", { exact: true }).fill("2026-10-19T10:00");
  await form.getByRole("button", { name: "保存草稿并提炼", exact: true }).click();
  const panel = page.getByRole("region", { name: "AI 会议提炼", exact: true }); await expect(panel).toBeVisible(); await panel.getByLabel("会议转写稿", { exact: true }).fill("合成会议讨论接口联调，张工下周一整理联调计划，PM 确认后执行。"); await panel.getByRole("checkbox").check(); await panel.getByRole("button", { name: "AI 提炼纪要", exact: true }).click();
  await expect(panel.getByRole("button", { name: "应用到纪要草稿" })).toBeVisible({ timeout: 45000 }); await panel.getByRole("button", { name: "应用到纪要草稿" }).click();
  await expect(page.getByLabel("草稿正文", { exact: true })).toHaveValue(/会议确认了接口联调范围/);
  await page.getByRole("button", { name: "定稿并锁定正文", exact: true }).click(); await expect(page.getByRole("article", { name: "会议纪要详情" }).getByText(/已定稿，只读/)).toBeVisible(); expect(await db.task.count({ where: { projectId } })).toBe(initialTaskCount);
});
test("overlong input is blocked before the provider and cancellation stops the provider", async ({ page }) => {
  test.setTimeout(90000); const panel = await open(page); await panel.getByLabel("会议转写稿", { exact: true }).fill("会".repeat(8001)); await expect(panel.getByText(/文本过长，请分段提炼/)).toBeVisible(); await expect(panel.getByRole("button", { name: "AI 提炼纪要", exact: true })).toBeDisabled();
  const response = await page.request.post(`/api/projects/${projectId}/meetings/${meetingId}/summarize`, { data: { text: "会".repeat(8001), expectedVersion: 1, syntheticDataConfirmed: true } }); expect(response.status()).toBe(413);
  const baseline = await control("hold"); await panel.getByLabel("会议转写稿", { exact: true }).fill("合成会议需要整理接口问题，并明确验收安排。"); await panel.getByRole("checkbox").check(); await panel.getByRole("button", { name: "AI 提炼纪要", exact: true }).click(); await expect(panel.getByText(/会议确认了接口联调/)).toBeVisible();
  await panel.getByRole("button", { name: "停止生成" }).click(); const stopped = await panel.getByLabel("AI 摘要预览").textContent();
  await expect.poll(async () => (await control("hold")).cancelled).toBeGreaterThan(baseline.cancelled); expect(await panel.getByLabel("AI 摘要预览").textContent()).toBe(stopped);
  expect(await db.aiSuggestion.count({ where: { projectId, input: { path: "$.meetingId", equals: meetingId } } })).toBe(0);
});
test("correction progress is visible and cancellation during retry leaves no partial suggestion", async ({ page }) => {
  test.setTimeout(90000); await control("retry-hold-1"); const panel = await generate(page);
  await expect(panel.getByText("输出格式校验未通过，正在自动修正...", { exact: true })).toBeVisible({ timeout: 45000 });
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/05-retry-progress.png`, fullPage: true }); await panel.getByRole("button", { name: "停止生成" }).click();
  expect(await db.aiSuggestion.count({ where: { projectId, input: { path: "$.meetingId", equals: meetingId } } })).toBe(0);
});
test("permission revoked during streaming emits a toast and cannot save", async ({ page }) => {
  test.setTimeout(90000); await control("hold"); const panel = await generate(page); await expect(panel.getByText(/会议确认了接口联调/)).toBeVisible();
  await db.$transaction(tx => tx.user.update({ where: { id: actorId }, data: { role: "MEMBER" } })); await control("release");
  await expect(page.getByRole("alert").filter({ hasText: /权限或会话已变化|权限已变更/ }).first()).toBeVisible({ timeout: 45000 }); if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/06-permission-revoked-toast.png`, fullPage: true });
  expect(await db.aiSuggestion.count({ where: { projectId, input: { path: "$.meetingId", equals: meetingId } } })).toBe(0);
});
