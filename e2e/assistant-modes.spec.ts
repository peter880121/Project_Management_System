import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
import { GENERAL_PREFIX, REPORT_MESSAGE, WEB_WARNING } from "../src/modules/ai/assistant/routing";
const db = new PrismaClient(); let actorId: string; let projectId: string;
const fixture = process.env.AI_STREAM_FIXTURE_URL;
test.use({ trace: "off" });
test.skip(!fixture, "Requires the isolated streaming and search fixture");
const stats = () => fetch(`${fixture}/__fixture/stats`).then(r => r.json());
const control = (mode: string) => fetch(`${fixture}/__fixture/control?mode=${mode}`, { method: "POST" }).then(r => r.json());
test.beforeAll(async () => {
  await db.$transaction(async tx => {
    actorId = (await tx.user.create({ data: { name: "Synthetic mode PM", email: `${randomUUID()}@medpm.local`, role: "PM", status: "ACTIVE" } })).id;
    projectId = (await tx.project.create({ data: { name: "Y市HIS合成演示", ownerId: actorId, status: "ACTIVE" } })).id;
  });
});
test.afterAll(() => db.$disconnect());
test.beforeEach(async ({ context, baseURL, page }) => {
  await control("normal"); await context.addCookies([{ name: "medpm_session", value: createSessionToken(actorId, Date.now() + 3600000), url: baseURL!, httpOnly: true }]);
  await page.goto("/"); await page.getByLabel("检索范围", { exact: true }).selectOption(projectId);
});
async function send(page: Page, question: string, mode = "SMART") {
  await page.getByLabel("回答模式", { exact: true }).selectOption(mode);
  await page.getByLabel("向智能助手提问", { exact: true }).fill(question);
  await page.getByRole("checkbox", { name: "仅使用合成数据，同意发送至配置的 AI 服务", exact: true }).check();
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
}
const answers = (page: Page) => page.getByRole("article", { name: "助手回答", exact: true });
async function approve(page: Page) {
  const modal = page.getByRole("dialog", { name: "确认联网搜索", exact: true });
  await modal.getByRole("checkbox").check(); await modal.getByRole("button", { name: "确认向外网发送", exact: true }).click();
}
test("composer is centered on desktop, fits mobile and moves below conversation without losing input controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const form = page.getByRole("form", { name: "智能助手提问", exact: true });
  const main = page.getByRole("main", { name: "MedPM 智能助手", exact: true });
  const initial = await form.boundingBox(); const area = await main.boundingBox();
  expect(initial).not.toBeNull(); expect(area).not.toBeNull();
  expect(Math.abs(initial!.x + initial!.width / 2 - area!.x - area!.width / 2)).toBeLessThan(3);
  expect(Math.abs(initial!.y + initial!.height / 2 - area!.y - area!.height / 2)).toBeLessThan(area!.height * 0.18);
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: "test-results/assistant-centered-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "WBS是什么？怎么开项目启动会？", exact: true }).click();
  await expect(page.getByLabel("向智能助手提问", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("回答模式", { exact: true }).selectOption("WEB"); await expect(page.getByRole("note")).toHaveText(WEB_WARNING);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 }); await send(page, "WBS是什么？");
  await expect(answers(page)).toContainText(GENERAL_PREFIX); await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0, { timeout: 20000 });
  const after = await form.boundingBox(); expect(after!.y).toBeGreaterThan(initial!.y);
  await expect(form).toHaveCount(1); await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今天，有什么想了解的？", exact: true })).toBeVisible();
  await expect(form).toHaveCount(1); await expect(page.getByLabel("回答模式", { exact: true })).toHaveValue("SMART");
});
test("general knowledge carries the exact disclaimer and strict length; internal mode never falls back", async ({ page }) => {
  const before = await stats(); await expect(page.getByRole("link", { name: "智能助手", exact: true })).toBeVisible();
  await send(page, "WBS是什么？怎么开启动会？"); await expect(answers(page)).toContainText(GENERAL_PREFIX);
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0, { timeout: 20000 });
  const text = await answers(page).locator("p.whitespace-pre-wrap").innerText(); expect(text.startsWith(GENERAL_PREFIX)).toBe(true); expect(Array.from(text).length).toBeLessThanOrEqual(300);
  await expect(answers(page)).toContainText("通用知识 · 未验证项目库"); expect((await stats()).generalStarted).toBe(before.generalStarted + 1);
  await send(page, "WBS是什么？", "INTERNAL"); await expect(answers(page)).toHaveCount(2); await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
  await expect(answers(page).last()).not.toContainText(GENERAL_PREFIX); expect((await stats()).generalStarted).toBe(before.generalStarted + 1);
});
test("live reporting is blocked in all modes without invoking the model or external search", async ({ page }) => {
  const before = await stats();
  for (const [index, mode] of ["SMART", "INTERNAL", "WEB"].entries()) {
    await send(page, index === 1 ? "谁的任务负荷最重？" : "当前有多少任务？", mode);
    await expect(answers(page)).toHaveCount(index + 1); await expect(answers(page).last()).toContainText(REPORT_MESSAGE);
    await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
  }
  expect((await stats()).started).toBe(before.started); expect((await stats()).searches).toBe(before.searches);
});
test("web confirmation precedes all outbound work; source metadata is persisted and isolated from chat history", async ({ page }) => {
  test.setTimeout(90000); await send(page, "什么是INTERNAL_ONLY_SYNTHETIC_HISTORY？");
  await expect(answers(page)).toContainText(GENERAL_PREFIX); await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0, { timeout: 20000 });
  const before = await stats(); const rows = await db.ragMessage.count(); const question = "Y市HIS的公开FDA指南有哪些？";
  await send(page, question, "WEB"); await expect(page.getByRole("note")).toHaveText(WEB_WARNING);
  const modal = page.getByRole("dialog", { name: "确认联网搜索", exact: true });
  await expect(modal).toContainText("您的问题包含项目专有名词，确认要向外网发送吗？"); await expect(modal.getByLabel("拟发送的搜索词")).toHaveValue(question.normalize("NFKC"));
  await expect(modal.getByRole("button", { name: "确认向外网发送", exact: true })).toBeDisabled();
  expect((await stats()).searches).toBe(before.searches); expect(await db.ragMessage.count()).toBe(rows);
  await modal.getByRole("button", { name: "返回修改提问", exact: true }).click(); await expect(page.getByLabel("向智能助手提问", { exact: true })).toHaveValue(question);
  expect((await stats()).searches).toBe(before.searches);
  await send(page, question, "WEB"); await approve(page); await expect(answers(page)).toHaveCount(2); await expect(answers(page).last()).toContainText("联网资料 · 非内部制度", { timeout: 20000 });
  const answer = answers(page).last(); await answer.locator("summary").click(); await expect(answer).toContainText("检索时间："); await expect(answer).toContainText("发布日期：");
  await expect(answer.getByRole("link", { name: "查看网页来源 ↗", exact: true })).toHaveAttribute("href", "https://www.fda.gov/synthetic-guidance");
  const after = await stats(); expect(after.searches).toBe(before.searches + 1); expect(after.lastSearchQuery).toBe(question.normalize("NFKC"));
  expect(after.lastSearchKeys).not.toContain("messages"); expect(after.lastWebInput).not.toContain("INTERNAL_ONLY_SYNTHETIC_HISTORY");
  const saved = await db.ragMessage.findFirstOrThrow({ where: { conversation: { userId: actorId }, content: question, role: "USER" }, orderBy: { createdAt: "desc" } });
  expect(saved.webQuery).toBe(question.normalize("NFKC")); expect(await db.ragCitation.count({ where: { message: { conversationId: saved.conversationId }, sourceType: "WEB" } })).toBe(1);
});
test("forged or rebound confirmation cannot bypass the server gate", async ({ page }) => {
  const before = await stats(); const rows = await db.ragMessage.count();
  const response = await page.request.post("/api/assistant/conversations", { data: { projectId } }); const { data } = await response.json();
  const body = { question: "Y市HIS公开指南", requestKey: randomUUID(), expectedVersion: data.rowVersion, syntheticOnly: true, mode: "WEB" };
  const challenge = await page.request.post(`/api/assistant/conversations/${data.id}/messages`, { data: body }); expect(challenge.status()).toBe(428);
  const { confirmation } = await challenge.json();
  for (const invalid of [{ ...body, webConfirmationToken: "forged" }, { ...body, question: "另一问题", webConfirmationToken: confirmation.token }]) {
    expect((await page.request.post(`/api/assistant/conversations/${data.id}/messages`, { data: invalid })).status()).toBe(409);
  }
  expect(await db.ragMessage.count()).toBe(rows); expect((await stats()).searches).toBe(before.searches);
});
test("stopping during external search aborts the provider and leaves no partial answer or citations", async ({ page }) => {
  test.setTimeout(60000); const before = await control("search-hold"); const question = `公开指南停止测试${randomUUID()}`;
  await send(page, question, "WEB"); await approve(page); await expect.poll(async () => (await stats()).searches).toBe(before.searches + 1);
  await expect(answers(page)).toHaveCount(1); await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(answers(page)).toContainText("本轮已停止"); await expect.poll(async () => (await stats()).searchCancelled).toBeGreaterThan(before.searchCancelled);
  await expect.poll(async () => (await db.ragMessage.findFirst({ where: { role: "ASSISTANT", conversation: { userId: actorId }, requestKey: (await db.ragMessage.findFirst({ where: { content: question, role: "USER" } }))?.requestKey } }))?.status).toBe("STOPPED");
  const row = await db.ragMessage.findFirstOrThrow({ where: { content: question, role: "USER" } });
  const result = await db.ragMessage.findFirstOrThrow({ where: { conversationId: row.conversationId, requestKey: row.requestKey, role: "ASSISTANT" }, include: { citations: true } });
  expect(result.content).toBe(""); expect(result.citations).toHaveLength(0); await control("release");
});
test("search outage is explicit and never invents a model fallback", async ({ page }) => {
  const before = await control("search-fail"); await send(page, "公开指南故障测试", "WEB"); await approve(page);
  await expect(page.getByRole("alert").filter({ hasText: "联网搜索服务暂不可用" })).toBeVisible({ timeout: 20000 });
  expect((await stats()).webAnswerStarted).toBe(before.webAnswerStarted); expect((await stats()).generalStarted).toBe(before.generalStarted);
});

