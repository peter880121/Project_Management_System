import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
import { syntheticDocx } from "../tests/fixtures/docx";
import { execFileSync } from "node:child_process";
const db = new PrismaClient(); const pm = "00000000-0000-4000-8000-000000000002", qa = "00000000-0000-4000-8000-000000000004";
let projectId: string;
test.use({ trace: "off" });
test.beforeEach(async ({ context, baseURL }) => {
  await db.$transaction(async tx => { projectId = (await tx.project.create({ data: { name: "合成会议附件项目", status: "ACTIVE", ownerId: pm } })).id; await tx.projectMember.create({ data: { projectId, userId: qa } }); });
  await context.addCookies([{ name: "medpm_session", value: createSessionToken(pm, Date.now() + 3600000), url: baseURL!, httpOnly: true }]);
});
test.afterAll(() => db.$disconnect());
test("creates a meeting with attachments, appends evidence and preserves exact downloads", async ({ page }) => {
  test.setTimeout(90000); await page.goto(`/projects/${projectId}/meetings`);
  const form = page.getByRole("form", { name: "创建会议纪要", exact: true });
  await form.getByLabel("会议标题", { exact: true }).fill("合成项目启动会"); await form.getByLabel("会议时间", { exact: true }).fill("2026-10-20T09:00"); await form.getByLabel("会议正文", { exact: true }).fill("确认范围与交付证据，仅使用合成数据。");
  const txt = Buffer.from("Synthetic kickoff evidence");
  await form.getByLabel("新纪要附件（可选）", { exact: true }).setInputFiles([{ name: "kickoff.txt", mimeType: "text/plain", buffer: txt }, { name: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: syntheticDocx() }]);
  await expect(form.getByRole("button", { name: "保存会议纪要", exact: true })).toBeDisabled(); await form.getByRole("checkbox", { name: "确认所选附件仅含合成数据，不含真实患者信息", exact: true }).check(); await form.getByRole("button", { name: "保存会议纪要", exact: true }).click();
  const detail = page.getByRole("article", { name: "会议纪要详情", exact: true }); const attachments = detail.getByRole("region", { name: "会议附件", exact: true });
  await expect(attachments.getByRole("link", { name: "下载附件 · kickoff.txt", exact: true })).toBeVisible({ timeout: 20000 }); await expect(attachments.getByRole("link", { name: "下载附件 · notes.docx", exact: true })).toBeVisible();
  const original = await db.document.findFirstOrThrow({ where: { projectId, filename: "kickoff.txt" } }); const download = await page.request.get(`/api/documents/${original.id}/download`); expect(download.status()).toBe(200); expect(await download.body()).toEqual(txt);
  await attachments.getByLabel("选择会议附件", { exact: true }).setInputFiles({ name: "supplement.md", mimeType: "text/markdown", buffer: Buffer.from("# Synthetic supplement") }); await attachments.getByRole("checkbox", { name: "确认附件仅含合成数据，不含真实患者信息", exact: true }).check(); await attachments.getByRole("button", { name: "上传所选附件", exact: true }).click(); await expect(attachments.getByRole("link", { name: "下载附件 · supplement.md", exact: true })).toBeVisible();
  expect(await db.meetingRecord.count({ where: { projectId } })).toBe(1); expect(await db.document.count({ where: { projectId, meetingAttachmentId: original.meetingAttachmentId } })).toBe(3); expect(await db.document.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original); expect(await db.auditLog.count({ where: { projectId, action: "MEETING_ATTACHMENT_ADDED" } })).toBe(3);
  const supplement = attachments.locator("li").filter({ hasText: "supplement.md" });
  await supplement.getByText("知识库解析与索引", { exact: true }).click(); await supplement.getByRole("button", { name: "开始解析", exact: true }).click(); await expect(supplement).toContainText("等待 worker");
  execFileSync(process.execPath, ["tests/fixtures/local-document-worker.mjs"], { env: process.env, stdio: "pipe", windowsHide: true, timeout: 15000 });
  await attachments.getByRole("button", { name: "刷新附件", exact: true }).click(); await expect(supplement).toContainText("解析成功");
});
test("enforces private meeting and draft permissions on list and guessed document URLs", async ({ page, browser, baseURL }) => {
  test.setTimeout(60000);
  const response = await page.request.post(`/api/projects/${projectId}/meetings`, { data: { title: "Private synthetic meeting", content: "Synthetic private evidence", meetingDate: new Date().toISOString(), status: "FINALIZED", actionItems: [], visibleRoles: ["PM"], requestKey: crypto.randomUUID() } }); expect(response.status()).toBe(201); const meetingId = (await response.json()).data.id;
  const upload = await page.request.post(`/api/projects/${projectId}/meetings/${meetingId}/attachments`, { multipart: { file: { name: "private.md", mimeType: "text/markdown", buffer: Buffer.from("# Synthetic private evidence") }, syntheticOnly: "true", uploadKey: crypto.randomUUID() } }); expect(upload.status()).toBe(201); const documentId = (await upload.json()).data.id;
  const reviewer = await browser.newContext(); try {
    await reviewer.addCookies([{ name: "medpm_session", value: createSessionToken(qa, Date.now() + 3600000), url: baseURL!, httpOnly: true }]);
    expect((await reviewer.request.get(`${baseURL}/api/projects/${projectId}/meetings/${meetingId}/attachments`)).status()).toBe(403);
    expect((await reviewer.request.get(`${baseURL}/api/documents/${documentId}/download`)).status()).toBe(403);
    expect((await reviewer.request.get(`${baseURL}/api/documents/${documentId}/parse`)).status()).toBe(403);
    const docs = await reviewer.request.get(`${baseURL}/api/projects/${projectId}/documents`); expect((await docs.json()).data.some((row: { id: string }) => row.id === documentId)).toBe(false);
    const draft = await page.request.post(`/api/projects/${projectId}/meetings`, { data: { title: "Draft synthetic meeting", content: "Synthetic", meetingDate: new Date().toISOString(), status: "DRAFT", actionItems: [], visibleRoles: ["PM", "QA"], requestKey: crypto.randomUUID() } }); const draftId = (await draft.json()).data.id;
    const draftUpload = await page.request.post(`/api/projects/${projectId}/meetings/${draftId}/attachments`, { multipart: { file: { name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic draft") }, syntheticOnly: "true", uploadKey: crypto.randomUUID() } }); expect(draftUpload.status()).toBe(201); const draftDoc = (await draftUpload.json()).data.id;
    expect((await reviewer.request.get(`${baseURL}/api/documents/${draftDoc}/download`)).status()).toBe(403);
    expect((await reviewer.request.get(`${baseURL}/api/projects/${projectId}/meetings/${draftId}/attachments`)).status()).toBe(403);
  } finally { await reviewer.close(); }
});
test("retains a saved meeting and retries only the failed attachment", async ({ page }) => {
  test.setTimeout(60000); let attempts = 0;
  await page.route(`**/api/projects/${projectId}/meetings/*/attachments`, async route => { if (route.request().method() === "POST" && ++attempts === 1) await route.fulfill({ status: 503, json: { error: "Synthetic temporary outage before upload" } }); else await route.continue(); });
  await page.goto(`/projects/${projectId}/meetings`); const form = page.getByRole("form", { name: "创建会议纪要", exact: true }); await form.getByLabel("会议标题", { exact: true }).fill("合成附件重试会议"); await form.getByLabel("会议时间", { exact: true }).fill("2026-10-20T10:00"); await form.getByLabel("会议正文", { exact: true }).fill("Synthetic retry evidence"); await form.getByLabel("新纪要附件（可选）", { exact: true }).setInputFiles([{ name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("one") }, { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("two") }]); await form.getByRole("checkbox", { name: "确认所选附件仅含合成数据，不含真实患者信息", exact: true }).check(); await form.getByRole("button", { name: "保存会议纪要", exact: true }).click();
  await expect(page.getByText("会议已保存，部分附件未完成，可在详情核实后重试", { exact: true })).toBeVisible({ timeout: 15000 });
  const attachments = page.getByRole("region", { name: "会议附件", exact: true }); await expect(attachments.getByRole("link")).toHaveCount(1); await attachments.getByRole("checkbox", { name: "确认附件仅含合成数据，不含真实患者信息", exact: true }).check(); await attachments.getByRole("button", { name: "上传所选附件", exact: true }).click(); await expect(attachments.getByRole("link")).toHaveCount(2); expect(attempts).toBe(3); expect(await db.meetingRecord.count({ where: { projectId } })).toBe(1);
});
