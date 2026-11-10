import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";
test.use({ trace: "off" });
const db = new PrismaClient(); const evidence = "test-results/delivery-assets-evidence";
let password: string; let projectId: string; let taskId: string; let pmId: string; let qaId: string; let outsiderId: string; let pmEmail: string; let qaEmail: string; let outsiderEmail: string;
const pdf = (version: number) => Buffer.from(`%PDF-1.4\nSynthetic delivery report V${version}\n%%EOF`);
async function login(request: APIRequestContext, email: string) { expect((await request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200); }
async function upload(request: APIRequestContext, version: number) {
  const res = await request.post(`/api/projects/${projectId}/documents`, { multipart: { file: { name: `synthetic-report-v${version}.pdf`, mimeType: "application/pdf", buffer: pdf(version) }, syntheticOnly: "true", uploadKey: randomUUID() } }); expect(res.status()).toBe(201); return (await res.json()).data.id as string;
}
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || ""; if (!password) throw new Error("Synthetic test password required"); const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => {
    const pm = await tx.user.create({ data: { email: `assets-pm-${randomUUID()}@medpm.local`, name: "Synthetic delivery PM", passwordHash, role: "PM", status: "ACTIVE" } }); pmId = pm.id; pmEmail = pm.email;
    const qa = await tx.user.create({ data: { email: `assets-qa-${randomUUID()}@medpm.local`, name: "Synthetic evidence QA", passwordHash, role: "QA", status: "ACTIVE" } }); qaId = qa.id; qaEmail = qa.email;
    const other = await tx.user.create({ data: { email: `assets-other-${randomUUID()}@medpm.local`, name: "Synthetic outsider QA", passwordHash, role: "QA", status: "ACTIVE" } }); outsiderId = other.id; outsiderEmail = other.email;
    projectId = (await tx.project.create({ data: { name: "医疗交付资产验收（合成数据）", ownerId: pmId } })).id;
    await tx.projectMember.create({ data: { projectId, userId: qaId } });
    await tx.project.create({ data: { name: "Other synthetic project", ownerId: outsiderId } });
    taskId = (await tx.task.create({ data: { projectId, title: "交付验收报告", description: "所属阶段：验收与移交\n提交独立版本的合成交付报告，并由 QA 审批。", status: "IN_PROGRESS", requiresDeliverable: true } })).id;
  }); await mkdir(evidence, { recursive: true });
});
test.afterAll(async () => { try { await db.$transaction(tx => tx.session.deleteMany({ where: { userId: { in: [pmId, qaId, outsiderId] } } })); } finally { await db.$disconnect(); } });
test.beforeEach(async ({ page }) => { await db.$transaction(tx => tx.user.update({ where: { id: pmId }, data: { role: "PM" } })); await login(page.request, pmEmail); });
test("board guides before password, uploads V1, approves evidence, preserves V1 while creating V2, and signs DONE", async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.goto(`/projects/${projectId}/board`); const card = page.locator(`[data-task-card="${taskId}"]`);
  await expect(card.getByLabel("需交付物", { exact: true })).toBeVisible();
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/01-board-requires-deliverable.png`, fullPage: true });
  await card.getByRole("button", { name: "完成", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "任务详情", exact: true });
  await expect(drawer.getByText(/该任务必须挂载交付物/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "电子签名", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("tab", { name: "📎 交付物管理", exact: true })).toHaveAttribute("aria-selected", "true");
  await drawer.getByRole("tab", { name: "📎 交付物管理", exact: true }).scrollIntoViewIfNeeded();
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/02-drawer-deliverable-tab.png`, fullPage: true });
  await drawer.getByLabel("交付物名称", { exact: true }).fill("合成交付验收报告");
  await drawer.getByLabel("交付文件（PDF / DOCX / TXT / TEXT / MD）", { exact: true }).setInputFiles({ name: "synthetic-report-v1.pdf", mimeType: "application/pdf", buffer: pdf(1) });
  await drawer.getByRole("checkbox", { name: /我确认文件仅包含合成数据/ }).check();
  const versionSaved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/projects/${projectId}/deliverables`);
  await drawer.getByRole("button", { name: "保存交付版本", exact: true }).click();
  expect((await versionSaved).status()).toBe(201);
  await expect(drawer.getByText("交付版本 V1", { exact: true })).toBeVisible();
  await drawer.getByRole("checkbox", { name: /同意批准后将合成 PDF/ }).check();
  await drawer.getByRole("button", { name: "提交审批", exact: true }).click();
  await expect(drawer.getByText("待审批", { exact: true })).toBeVisible();
  await drawer.getByText("交付版本 V1", { exact: true }).scrollIntoViewIfNeeded();
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/02b-drawer-submitted-version.png`, fullPage: true });
  const deliverable = await db.deliverable.findFirstOrThrow({ where: { projectId, taskId, version: 1 } });
  const qaContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL }); const qaPage = await qaContext.newPage();
  try {
    await login(qaContext.request, qaEmail); await qaPage.goto(`/projects/${projectId}/deliverables`);
    await qaPage.getByLabel("审批意见（拒绝时必填）").fill("合成报告范围与验收依据已复核，批准该文件版本。");
    await qaPage.getByRole("button", { name: "批准交付物", exact: true }).click();
    await expect(qaPage.getByText("已批准", { exact: true })).toBeVisible();
    await expect(qaPage.getByText(/已批准版本只读/)).toBeVisible();
    if (process.env.E2E_CAPTURE_EVIDENCE === "1") await qaPage.screenshot({ path: `${evidence}/03-approved-evidence.png`, fullPage: true });
  } finally { await qaContext.close(); }
  const original = await db.deliverable.findUniqueOrThrow({ where: { id: deliverable.id }, include: { document: true } });
  expect(original.document.parseStatus).toBe("QUEUED");
  await drawer.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(drawer.getByText("已批准", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "基于 V1 上传新版本", exact: true }).click();
  await expect(drawer.getByText(/基准版本：V1/)).toBeVisible();
  await drawer.getByLabel("交付文件（PDF / DOCX / TXT / TEXT / MD）", { exact: true }).setInputFiles({ name: "synthetic-report-v2.pdf", mimeType: "application/pdf", buffer: pdf(2) });
  await drawer.getByRole("checkbox", { name: /我确认文件仅包含合成数据/ }).check();
  await drawer.getByText(/基准版本：V1/).scrollIntoViewIfNeeded();
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/05-version-comparison.png`, fullPage: true });
  await drawer.getByRole("button", { name: "保存交付版本", exact: true }).click();
  await expect(drawer.getByText("交付版本 V2", { exact: true })).toBeVisible();
  const v2 = await db.deliverable.findFirstOrThrow({ where: { projectId, seriesId: original.seriesId, version: 2 }, include: { document: true } });
  expect(v2.documentId).not.toBe(original.documentId); expect(v2.document.sha256).not.toBe(original.document.sha256);
  expect(await db.deliverable.findUnique({ where: { id: original.id }, include: { document: true } })).toEqual(original);
  const download = await page.request.get(`/api/documents/${original.documentId}/download`); expect(download.status()).toBe(200); expect(await download.body()).toEqual(pdf(1));
  await drawer.getByRole("tab", { name: "任务信息", exact: true }).click();
  await drawer.getByRole("button", { name: "完成", exact: true }).click();
  const signature = page.getByRole("dialog", { name: "电子签名", exact: true }); await signature.getByLabel("签名实际工时").fill("2"); await signature.getByLabel("签名密码", { exact: true }).fill(password);
  await signature.getByRole("button", { name: "确认签署", exact: true }).click();
  await expect(signature).toHaveCount(0); expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("DONE");
  const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: taskId, action: "TASK_SIGNED_AND_COMPLETED" } }); expect(audit.after).toMatchObject({ completionEvidence: { id: original.id, version: 1, document: { sha256: original.document.sha256 } } });
});
test("cross-project QA and self-review are 403; status injection cannot approve", async ({ page, browser }) => {
  const documentId = await upload(page.request, 3);
  expect((await page.request.post(`/api/projects/${projectId}/deliverables`, { data: { name: "Forged", documentId, status: "APPROVED" } })).status()).toBe(400);
  const created = await page.request.post(`/api/projects/${projectId}/deliverables`, { data: { name: "边界测试报告", documentId } }); expect(created.status()).toBe(201); const d = (await created.json()).data;
  expect((await page.request.post(`/api/deliverables/${d.id}/submit`, { data: { rowVersion: 1, cloudProcessingConfirmed: true } })).status()).toBe(200);
  expect((await page.request.post(`/api/deliverables/${d.id}/review`, { data: { decision: "APPROVED", rowVersion: 2 } })).status()).toBe(403);
  const other = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  try { await login(other.request, outsiderEmail); expect((await other.request.post(`/api/deliverables/${d.id}/review`, { data: { decision: "APPROVED", rowVersion: 2 } })).status()).toBe(403); } finally { await other.close(); }
  await db.$transaction(tx => tx.user.update({ where: { id: pmId }, data: { role: "ADMIN" } }));
  const self = await page.request.post(`/api/deliverables/${d.id}/review`, { data: { decision: "APPROVED", rowVersion: 2 } }); expect(self.status()).toBe(403); expect((await self.json()).error).toContain("不能审批自己");
  expect((await db.deliverable.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("PENDING_REVIEW"); expect(await db.auditLog.count({ where: { entityId: d.id, action: "DELIVERABLE_REVIEWED" } })).toBe(0);
});
test("meeting checklist is persisted, private meetings reject QA, and manual knowledge sync queues durable work", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1360, height: 1100 });
  await page.goto(`/projects/${projectId}/meetings`); const form = page.getByRole("form", { name: "创建会议纪要" });
  await form.getByLabel("会议标题", { exact: true }).fill("项目启动会（合成纪要）"); await form.getByLabel("会议时间", { exact: true }).fill("2026-10-18T09:00");
  await form.getByLabel("会议正文", { exact: true }).fill("确认合成交付范围、角色分工与验收标准。会议已召开，后续由 PM 按行动项创建任务。");
  await form.getByRole("button", { name: "＋ 添加行动项", exact: true }).click(); await form.getByLabel("行动项 1", { exact: true }).fill("确认项目角色与责任矩阵"); await form.getByLabel("行动项 1 已落实", { exact: true }).check();
  await form.getByRole("button", { name: "＋ 添加行动项", exact: true }).click(); await form.getByLabel("行动项 2", { exact: true }).fill("安排交付报告评审并建立验证任务");
  await form.getByRole("checkbox", { name: /仅项目 PM 可见/ }).check();
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/04-meeting-create-checklist.png`, fullPage: true });
  await form.getByRole("button", { name: "保存会议纪要", exact: true }).click();
  const detail = page.getByRole("article", { name: "会议纪要详情" }); await expect(detail.getByText("确认项目角色与责任矩阵", { exact: true })).toBeVisible();
  const row = await db.meetingRecord.findFirstOrThrow({ where: { projectId, title: "项目启动会（合成纪要）" } }); expect(row.actionItems).toMatchObject([{ checked: true }, { checked: false }]);
  const qa = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  try { await login(qa.request, qaEmail); expect((await qa.request.get(`/api/meetings/${row.id}`)).status()).toBe(403); const list = await qa.request.get(`/api/projects/${projectId}/meetings`); expect((await list.json()).data.some((r: { id: string }) => r.id === row.id)).toBe(false); } finally { await qa.close(); }
  await detail.getByRole("checkbox", { name: /我确认仅含合成数据/ }).check(); await detail.getByRole("button", { name: "同步至知识库", exact: true }).click();
  await expect(detail.getByText("AI 索引：同步中", { exact: true })).toBeVisible();
  const linked = await db.meetingRecord.findUniqueOrThrow({ where: { id: row.id } }); expect(linked.documentId).not.toBeNull(); expect(await db.assetSourceJob.count({ where: { documentId: linked.documentId!, status: "QUEUED" } })).toBe(1);
});
