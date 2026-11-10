import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { syntheticDocx } from "../tests/fixtures/docx";
import { createSessionToken } from "../src/modules/auth/session-token";
const db = new PrismaClient(); const pm = "00000000-0000-4000-8000-000000000002", qa = "00000000-0000-4000-8000-000000000004";
let projectId: string;
test.use({ trace: "off" });
test.beforeEach(async ({ context, baseURL }) => {
  await db.$transaction(async tx => { projectId = (await tx.project.create({ data: { name: "合成多格式交付项目", status: "ACTIVE", ownerId: pm } })).id; await tx.projectMember.create({ data: { projectId, userId: qa } }); });
  await context.addCookies([{ name: "medpm_session", value: createSessionToken(pm, Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]);
});
test.afterAll(() => db.$disconnect());
for (const extension of ["docx", "txt", "text", "md"]) test(`${extension} uploads, parses locally, previews inert text and downloads identical bytes`, async ({ page }) => {
  test.setTimeout(60000);
  const bytes = extension === "docx" ? syntheticDocx() : Buffer.from('# 合成需求规格\n\n保留签名与审批证据。\n\n<img src="http://external.invalid/test" onerror="alert(1)">');
  await page.goto(`/projects/${projectId}/documents`); await page.getByLabel("选择文件", { exact: true }).setInputFiles({ name: `合成说明.${extension}`, mimeType: "", buffer: bytes });
  await page.getByRole("checkbox", { name: "确认文件仅含合成数据，不含真实患者信息", exact: true }).check(); await page.getByRole("button", { name: "上传文档", exact: true }).click();
  const article = page.locator("article").filter({ has: page.getByRole("heading", { name: `合成说明.${extension}`, exact: true }) }); await expect(article).toContainText("可下载", { timeout: 15000 });
  await expect(article).toContainText("本地解析，不发送至 MinerU"); await expect(article.getByRole("checkbox")).toHaveCount(0);
  await article.getByRole("button", { name: "开始解析", exact: true }).click(); await expect(article).toContainText("已排队");
  const doc = await db.document.findFirstOrThrow({ where: { projectId, filename: `合成说明.${extension}` } }); expect((await db.documentParseJob.findFirstOrThrow({ where: { documentId: doc.id } })).provider).toBe("local-document-v1");
  execFileSync(process.execPath, ["tests/fixtures/local-document-worker.mjs"], { env: process.env, stdio: "pipe", windowsHide: true, timeout: 15000 });
  await article.getByRole("button", { name: "刷新解析任务", exact: true }).click(); await article.getByRole("button", { name: "预览解析结果", exact: true }).click();
  await expect(article.locator("pre")).toContainText("合成需求规格"); await expect(article.locator("img")).toHaveCount(0);
  await article.locator("details summary").click(); await expect(article).toContainText("无页码");
  const download = await page.request.get(`/api/documents/${doc.id}/download`); expect(download.status()).toBe(200); expect(download.headers()["content-type"]).toBe(doc.mediaType); expect(download.headers()["x-content-type-options"]).toBe("nosniff"); expect(await download.body()).toEqual(bytes);
});
test("DOCX deliverable submits without cloud consent and queues local parsing only after QA approval", async ({ page, browser, baseURL }) => {
  test.setTimeout(60000); await page.goto(`/projects/${projectId}/deliverables`); const panel = page.getByRole("region", { name: "交付物管理", exact: true });
  await panel.getByLabel("交付物名称", { exact: true }).fill("合成 DOCX 需求规格"); await panel.getByLabel("交付文件（PDF / DOCX / TXT / TEXT / MD）", { exact: true }).setInputFiles({ name: "requirements.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: syntheticDocx() });
  await panel.getByRole("checkbox", { name: "我确认文件仅包含合成数据，不含真实患者信息。", exact: true }).check(); await panel.getByRole("button", { name: "保存交付版本", exact: true }).click();
  const card = panel.locator("article").filter({ hasText: "合成 DOCX 需求规格" }); await expect(card).toContainText("草稿"); await expect(card.getByRole("checkbox")).toHaveCount(0); await card.getByRole("button", { name: "提交审批", exact: true }).click(); await expect(card).toContainText("待审批");
  const asset = await db.deliverable.findFirstOrThrow({ where: { projectId } }); expect(await db.documentParseJob.count({ where: { documentId: asset.documentId } })).toBe(0);
  const reviewer = await browser.newContext();
  try {
    await reviewer.addCookies([{ name: "medpm_session", value: createSessionToken(qa, Date.now() + 3_600_000), url: baseURL!, httpOnly: true }]);
    const qaPage = await reviewer.newPage(); await qaPage.goto(`${baseURL}/projects/${projectId}/deliverables`);
    const reviewedCard = qaPage.locator(`[data-deliverable="${asset.id}"]`); await expect(reviewedCard.getByRole("button", { name: "批准交付物", exact: true })).toBeVisible();
    await reviewedCard.getByRole("button", { name: "批准交付物", exact: true }).click(); await expect(reviewedCard).toContainText("已批准"); expect((await db.documentParseJob.findFirstOrThrow({ where: { documentId: asset.documentId } })).phase).toBe("LOCAL");
    execFileSync(process.execPath, ["tests/fixtures/local-document-worker.mjs"], { env: process.env, stdio: "pipe", windowsHide: true, timeout: 15000 });
    const download = await qaPage.request.get(`/api/documents/${asset.documentId}/download`); expect(download.status()).toBe(200); expect(await download.body()).toEqual(syntheticDocx());
  } finally { await reviewer.close(); }
});
test("disguised DOCX is rejected before storage or business rows are created", async ({ page }) => {
  const response = await page.request.post(`/api/projects/${projectId}/documents`, { multipart: { file: { name: "spoof.docx", mimeType: "application/octet-stream", buffer: Buffer.from("not a docx") }, syntheticOnly: "true", uploadKey: crypto.randomUUID() } });
  expect(response.status()).toBe(415); expect(await db.document.count({ where: { projectId } })).toBe(0);
});
