import { randomUUID, createHash } from "node:crypto";
import { PrismaClient, type Role } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
const db = new PrismaClient(); const users = new Map<Role, string>(); let projectId: string, chunkId: string, contactId: string, email: string;
test.use({ trace: "off" });
test.beforeAll(async () => {
  await db.$transaction(async tx => {
    for (const role of ["ADMIN", "PM", "QA", "MEMBER", "PMO"] as const) users.set(role, (await tx.user.create({ data: { name: `Synthetic assistant ${role}`, email: `${randomUUID()}@medpm.local`, role, status: "ACTIVE" } })).id);
    email = `${randomUUID()}@medpm.local`; contactId = (await tx.user.create({ data: { name: "张明 · 合成接口工程师", email, role: "MEMBER", status: "ACTIVE" } })).id;
    projectId = (await tx.project.create({ data: { name: "合成内部知识问答项目", ownerId: users.get("PM"), status: "ACTIVE" } })).id;
    await tx.projectMember.createMany({ data: [users.get("QA")!, users.get("MEMBER")!, users.get("PMO")!, contactId].map(userId => ({ projectId, userId })) });
    const text = "内部项目资料：任务须记录签名意图与实际完成日期，并保留交付证据。仅含合成数据。";
    const document = await tx.document.create({ data: { projectId, filename: "合成签署要求.md", minioKey: `synthetic/${randomUUID()}.md`, mediaType: "text/markdown", visibleRoles: ["ADMIN", "PM", "QA", "MEMBER", "PMO"], uploadedById: users.get("PM")!, storageStatus: "AVAILABLE", parsedVersion: 1, chunkedVersion: 1, parseVersion: 1, parseStatus: "SUCCEEDED" } });
    const job = await tx.documentParseJob.create({ data: { documentId: document.id, version: 1, requestedById: users.get("PM")!, requestKey: randomUUID(), modelVersion: "synthetic", sourceSha256: "a".repeat(64), sourceFilename: document.filename, sourceSize: 100, status: "SUCCEEDED", deadlineAt: new Date(), markdown: text } });
    chunkId = (await tx.documentChunk.create({ data: { projectId, documentId: document.id, parseJobId: job.id, version: 1, ordinal: 0, text, textSha256: createHash("sha256").update(text).digest("hex"), embeddingModel: "text-embedding-3-small", startOffset: 0, endOffset: text.length, vectorStatus: "SYNCED" } })).id;
  });
});
test.afterAll(() => db.$disconnect());
async function identify(context: import("@playwright/test").BrowserContext, baseURL: string, role: Role) { await context.addCookies([{ name: "medpm_session", value: createSessionToken(users.get(role)!, Date.now() + 3600000), url: baseURL, httpOnly: true }]); }
async function send(page: import("@playwright/test").Page, question: string) { await page.getByLabel("向智能助手提问", { exact: true }).fill(question); await page.getByRole("checkbox", { name: "仅使用合成数据，同意发送至配置的 AI 服务", exact: true }).check(); await page.getByRole("button", { name: "发送问题", exact: true }).click(); }
for (const role of ["ADMIN", "PM", "QA", "MEMBER", "PMO"] as const) test(`${role} sees the chat homepage and finds a maintained internal contact`, async ({ page, context, baseURL }) => {
  test.setTimeout(60000); await identify(context, baseURL!, role); await page.goto("/"); await expect(page.getByRole("main", { name: "MedPM 智能助手", exact: true })).toBeVisible(); expect(new URL(page.url()).pathname).toBe("/"); await send(page, "请查找张工的联系方式");
  const answer = page.getByRole("article", { name: "助手回答", exact: true }); await expect(answer).toContainText(email, { timeout: 20000 }); await expect(answer).toContainText("内部联系人优先"); await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "刷新对话", exact: true }).click(); await expect(answer).toContainText(email); await page.getByRole("button", { name: "重命名", exact: true }).click(); await page.getByLabel("对话名称", { exact: true }).fill("内部同事联系方式"); await page.getByRole("button", { name: "保存名称", exact: true }).click(); await expect(page.getByText("内部同事联系方式", { exact: true })).toBeVisible();
  if (role === "PM") { await send(page, "他的邮箱呢？"); await expect(page.getByRole("article", { name: "助手回答", exact: true }).last()).toContainText(email); }
});
test("recovers a committed answer after a truncated SSE response without duplicating the question", async ({ page, context, baseURL }) => {
  test.setTimeout(60000); await identify(context, baseURL!, "QA");
  await page.route("**/api/assistant/conversations/*/messages", async route => {
    const response = await route.fetch(); const body = await response.text(); await route.fulfill({ response, body: body.replace(/event: done\ndata:[^\n]*\n\n/g, "") });
  });
  await page.goto("/"); await send(page, "张明的邮箱是多少？"); await expect(page.getByRole("article", { name: "助手回答", exact: true })).toContainText(email, { timeout: 20000 }); await expect(page.getByText("已恢复保存的回答", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "你的问题", exact: true })).toHaveCount(1); await expect(page.getByLabel("向智能助手提问", { exact: true })).toHaveValue("");
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("streams grounded internal answers, stops the model and blocks mid-stream permission revocation", async ({ page, context, baseURL }) => {
  test.skip(!process.env.AI_STREAM_FIXTURE_URL, "Requires the isolated LangChain streaming fixture"); test.setTimeout(120000); await identify(context, baseURL!, "MEMBER");
  const control = (mode: string) => fetch(`${process.env.AI_STREAM_FIXTURE_URL}/__fixture/control?mode=${mode}`, { method: "POST" }).then(response => response.json());
  await control("normal"); await page.goto("/"); await page.getByLabel("检索范围", { exact: true }).selectOption(projectId); await send(page, "内部签名意图有哪些要求？");
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible(); await expect(page.getByRole("article", { name: "助手回答", exact: true })).toContainText("内部项目资料要求", { timeout: 20000 }); await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0, { timeout: 20000 });
  let answer = page.getByRole("article", { name: "助手回答", exact: true }); await expect(answer).toContainText("内部关键词检索"); await expect(answer).not.toContainText("PUBLIC_PREVIEW"); await expect(answer).not.toContainText("synthetic-private-content"); await answer.locator("summary").click(); await expect(answer.getByRole("link", { name: "查看原文依据 ↗", exact: true })).toHaveAttribute("href", `/projects/${projectId}/documents/chunks/${chunkId}`);
  const baseline = await control("hold"); await send(page, "这些签名要求有哪些证据？"); await expect(page.getByRole("article", { name: "助手回答", exact: true })).toHaveCount(2); await expect(page.getByRole("article", { name: "助手回答", exact: true }).last()).toContainText("内部项目资料要求", { timeout: 20000 }); await page.getByRole("button", { name: "停止生成", exact: true }).click(); await expect(page.getByRole("article", { name: "助手回答", exact: true }).last()).toContainText("本轮已停止"); await expect.poll(async () => (await control("hold")).cancelled).toBeGreaterThan(baseline.cancelled);
  await page.getByRole("button", { name: "刷新对话", exact: true }).click(); await control("hold"); await send(page, "内部签名日期要求是什么？"); await expect(page.getByRole("article", { name: "助手回答", exact: true })).toHaveCount(3); answer = page.getByRole("article", { name: "助手回答", exact: true }).last(); await expect(answer).toContainText("内部项目资料要求", { timeout: 20000 });
  await db.$transaction(tx => tx.projectMember.update({ where: { projectId_userId: { projectId, userId: users.get("MEMBER")! } }, data: { active: false } }));
  await expect(page.getByRole("alert").filter({ hasText: "权限或会话已变化" })).toBeVisible({ timeout: 15000 }); await expect(page.getByRole("article", { name: "助手回答", exact: true })).toHaveCount(0); await control("release");
});
