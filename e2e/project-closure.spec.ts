import { businessToday } from "../src/modules/tasks/plan";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";
test.use({ trace: "off" });
const db = new PrismaClient(); const evidence = "test-results/closure-evidence";
let password: string; let pmId: string; let qaId: string; let adminId: string; let memberId: string; let pmEmail: string; let qaEmail: string; let adminEmail: string; let projectId: string; let taskId: string;
async function login(request: APIRequestContext, email: string) { expect((await request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200); }
async function lifecycle(request: APIRequestContext) { const response = await request.get(`/api/projects/${projectId}/lifecycle`); expect(response.status()).toBe(200); return (await response.json()).data.project; }
async function transition(request: APIRequestContext, action: string) {
  const p = await lifecycle(request); const response = await request.post(`/api/projects/${projectId}/${action}`, { data: { expectedRowVersion: p.rowVersion, requestKey: randomUUID(), ...(p.currentAcceptanceId ? { acceptanceId: p.currentAcceptanceId } : {}), comment: "合成证据已复核，按当前快照处理。" } }); expect(response.status()).toBe(200); return (await response.json()).data;
}
async function complete(request: APIRequestContext) { expect((await request.patch(`/api/tasks/${taskId}`, { data: { status: "DONE", completedAt: businessToday(), actualHours: 2, signaturePassword: password, signatureReason: "确认验收与移交完成" } })).status()).toBe(200); }
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || ""; if (!password) throw new Error("Synthetic password required"); const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => {
    const accounts = [];
    for (const role of ["PM", "QA", "ADMIN", "MEMBER"] as const) accounts.push(await tx.user.create({ data: { name: `Synthetic closure ${role}`, email: `closure-${role}-${randomUUID()}@medpm.local`, passwordHash, role, status: "ACTIVE" } }));
    [pmId, qaId, adminId, memberId] = accounts.map(a => a.id); [pmEmail, qaEmail, adminEmail] = accounts.map(a => a.email);
  }); await mkdir(evidence, { recursive: true });
});
test.beforeEach(async ({ page }) => {
  await db.$transaction(async tx => {
    await tx.user.update({ where: { id: pmId }, data: { role: "PM" } });
    projectId = (await tx.project.create({ data: { name: "医疗交付闭环验收（合成项目）", ownerId: pmId, status: "ACTIVE" } })).id;
    await tx.projectMember.createMany({ data: [qaId, adminId, memberId].map(userId => ({ projectId, userId })) });
    taskId = (await tx.task.create({ data: { projectId, title: "合成交付验收", status: "IN_PROGRESS", description: "所属阶段：验收与移交\n按合成报告完成交付。", plannedStartDate: new Date("2026-10-19T00:00:00Z"), dueDate: new Date("2026-10-23T23:59:59.999Z"), estimateHours: 2 } })).id;
  }); await login(page.request, pmEmail);
});
test.afterAll(async () => { try { await db.$transaction(tx => tx.session.deleteMany({ where: { userId: { in: [pmId, qaId, adminId, memberId] } } })); } finally { await db.$disconnect(); } });
test("PM -> QA -> ADMIN closes a signed project, freezes assets, notifies members, and exports JSON/HTML", async ({ page, browser }) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 1360, height: 1000 });
  const qa = await browser.newContext({ baseURL: process.env.E2E_BASE_URL }); const admin = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  try {
    await login(qa.request, qaEmail); await login(admin.request, adminEmail);
    await page.goto(`/projects/${projectId}/acceptance`); await page.getByRole("button", { name: "提交验收", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "不能提交验收" }).first()).toBeVisible();
    if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/01-incomplete-acceptance-blocked.png`, fullPage: true });
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect((await page.request.patch(`/api/tasks/${taskId}`, { data: { requiresDeliverable: true, expectedUpdatedAt: task.updatedAt.toISOString() } })).status()).toBe(200);
    const uploaded = await page.request.post(`/api/projects/${projectId}/documents`, { multipart: { file: { name: "synthetic-closure-report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nSynthetic closure evidence\n%%EOF") }, uploadKey: randomUUID(), syntheticOnly: "true" } }); expect(uploaded.status()).toBe(201);
    const created = await page.request.post(`/api/projects/${projectId}/deliverables`, { data: { name: "合成交付验收报告", taskId, documentId: (await uploaded.json()).data.id } }); expect(created.status()).toBe(201); const d = (await created.json()).data;
    expect((await page.request.post(`/api/deliverables/${d.id}/submit`, { data: { rowVersion: 1, cloudProcessingConfirmed: true } })).status()).toBe(200);
    expect((await qa.request.post(`/api/deliverables/${d.id}/review`, { data: { rowVersion: 2, decision: "APPROVED", reviewComment: "合成交付版本已批准" } })).status()).toBe(200);
    await complete(page.request); await transition(page.request, "submit-acceptance"); await page.reload();
    await expect(page.getByText("待验收", { exact: true }).first()).toBeVisible();
    const qaPage = await qa.newPage(); await qaPage.goto(`/projects/${projectId}/acceptance`);
    await qaPage.getByLabel("审查意见 / 撤回或驳回原因").fill("已复核任务、交付版本及签名引用，与验收快照一致。");
    await qaPage.getByRole("button", { name: "QA 审查通过", exact: true }).click();
    await expect.poll(async () => (await db.projectAcceptance.findFirstOrThrow({ where: { projectId } })).state).toBe("QA_APPROVED");
    await qaPage.screenshot({ path: `${evidence}/02-qa-approved-state-flow.png`, fullPage: true });
    const adminPage = await admin.newPage(); await adminPage.goto(`/projects/${projectId}/acceptance`);
    await adminPage.getByRole("button", { name: "最终归档", exact: true }).click();
    await expect(adminPage.getByRole("region", { name: "结项报告导出" })).toBeVisible();
    await adminPage.screenshot({ path: `${evidence}/03-archived-state-flow.png`, fullPage: true });
    expect(await db.projectNotification.count({ where: { projectId } })).toBe(4);
    await adminPage.getByRole("button", { name: "结项通知", exact: true }).click();
    await expect(adminPage.getByRole("region", { name: "项目结项通知" }).getByRole("link")).toBeVisible();
    await adminPage.getByRole("button", { name: "结项通知", exact: true }).click();
    await adminPage.getByRole("button", { name: "预览 JSON 报告", exact: true }).click();
    const jsonView = adminPage.getByLabel("JSON 结项报告", { exact: true }); await expect(jsonView).toContainText("signatureAuditIds");
    await jsonView.scrollIntoViewIfNeeded(); await adminPage.screenshot({ path: `${evidence}/04-json-closure-report.png`, fullPage: false });
    const json = await admin.request.get(`/api/projects/${projectId}/report?format=json`); expect(json.status()).toBe(200); const payload = await json.json(); expect(payload.evidence.tasks[0].actualHours).toBe("2"); expect(payload.evidence.deliverables[0].version).toBe(1); await writeFile(`${evidence}/final-report.json`, JSON.stringify(payload, null, 2));
    const popup = adminPage.waitForEvent("popup"); await adminPage.getByRole("link", { name: "查看 HTML 报告", exact: true }).click(); const htmlPage = await popup; await htmlPage.waitForLoadState("domcontentloaded");
    await expect(htmlPage.getByRole("heading", { name: "最终任务与实际工时", exact: true })).toBeVisible(); await expect(htmlPage.getByText("已归档 · 只读报告", { exact: true })).toBeVisible();
    await htmlPage.screenshot({ path: `${evidence}/05-html-closure-report.png`, fullPage: true });
    const html = await admin.request.get(`/api/projects/${projectId}/report?format=html`); expect(html.status()).toBe(200); await writeFile(`${evidence}/final-report.html`, await html.text());
    expect(await db.auditLog.count({ where: { projectId, action: "DATA_EXPORTED", entityType: "ProjectAcceptance" } })).toBeGreaterThanOrEqual(4);
    await page.goto(`/projects/${projectId}/board`); await expect(page.getByText("已归档", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "创建任务", exact: true })).toHaveAttribute("aria-disabled", "true");
    const denial = await page.request.patch(`/api/tasks/${taskId}`, { data: { status: "IN_PROGRESS" } }); expect(denial.status()).toBe(403); expect((await denial.json()).code).toBe("PROJECT_ARCHIVED");
    await page.goto(`/projects/${projectId}/deliverables`); await expect(page.getByRole("button", { name: "基于 V1 上传新版本", exact: true })).toBeDisabled();
  } finally { await qa.close(); await admin.close(); }
});
test("QA sees a hash mismatch, rejects the batch, and PM gets an auditable correction loop", async ({ page, browser }) => {
  const qa = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  try {
    await login(qa.request, qaEmail); await complete(page.request); await transition(page.request, "submit-acceptance");
    await db.$executeRaw`UPDATE Task SET actualHours = 9 WHERE id = ${taskId}`;
    const qaPage = await qa.newPage(); await qaPage.goto(`/projects/${projectId}/acceptance`); await qaPage.getByRole("button", { name: "QA 审查通过", exact: true }).click();
    await expect(qaPage.getByRole("alert").filter({ hasText: "验收快照与当前证据不一致" }).first()).toBeVisible();
    await qaPage.evaluate(() => window.scrollTo(0, 0)); await qaPage.screenshot({ path: `${evidence}/06-snapshot-mismatch-blocked.png`, fullPage: true });
    await qaPage.getByLabel("审查意见 / 撤回或驳回原因").fill("当前证据与提交快照不一致，请整改后重新提交。"); await qaPage.getByRole("button", { name: "驳回验收", exact: true }).click();
    await expect.poll(async () => (await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("ACTIVE");
    expect((await db.projectAcceptance.findFirstOrThrow({ where: { projectId } })).state).toBe("REJECTED");
    expect(await db.auditLog.count({ where: { projectId, action: "PROJECT_ACCEPTANCE_REJECTED" } })).toBe(1);
  } finally { await qa.close(); }
});
for (const reason of ["role", "archive"]) test(`task plan 403 after ${reason} change clears the draft and switches the workspace to read-only`, async ({ page, browser }) => {
  test.setTimeout(90000); const before = await db.task.findUniqueOrThrow({ where: { id: taskId } }); let forbidden = 0; const contexts: BrowserContext[] = [];
  await page.goto(`/projects/${projectId}/board?taskId=${taskId}`);
  const drawer = page.getByRole("dialog", { name: "任务详情", exact: true }); await drawer.getByText("编辑计划安排", { exact: true }).click(); await drawer.getByLabel("计划预计工时", { exact: true }).fill("7");
  await page.route(`**/api/tasks/${taskId}/schedule`, async route => {
    if (reason === "role") await db.$transaction(tx => tx.user.update({ where: { id: pmId }, data: { role: "QA" } }));
    else {
      const qa = await browser.newContext({ baseURL: process.env.E2E_BASE_URL }); const admin = await browser.newContext({ baseURL: process.env.E2E_BASE_URL }); contexts.push(qa, admin);
      await login(qa.request, qaEmail); await login(admin.request, adminEmail); await complete(page.request); await transition(page.request, "submit-acceptance"); await transition(qa.request, "qa-approve"); await transition(admin.request, "archive");
    }
    const response = await route.fetch(); forbidden = response.status(); await route.fulfill({ response });
  });
  try {
    await drawer.getByRole("button", { name: "保存任务计划", exact: true }).click(); await expect.poll(() => forbidden).toBe(403);
    await expect(page.getByRole("alert").filter({ hasText: "该项目已被归档/权限已变更，页面已刷新" }).first()).toBeVisible();
    if (reason === "archive") await expect(page.locator("[data-project-readonly=true]")).toBeVisible();
    else {
      // QA retains review permissions: assert execution editing is revoked,
      // rather than incorrectly treating the entire ACTIVE project as frozen.
      await expect(page.getByRole("link", { name: "创建任务", exact: true })).toHaveCount(0);
      const current = await page.request.get(`/api/projects/${projectId}/lifecycle`);
      expect((await current.json()).data.capabilities.canEditTasks).toBe(false);
    }
    const after = await db.task.findUniqueOrThrow({ where: { id: taskId } }); expect(after.plannedStartDate).toEqual(before.plannedStartDate); expect(after.dueDate).toEqual(before.dueDate); expect(after.scheduleVersion).toBe(before.scheduleVersion);
    await expect(page.getByRole("button", { name: "保存任务计划", exact: true })).toHaveCount(0);
    if (process.env.E2E_CAPTURE_EVIDENCE === "1") await page.screenshot({ path: `${evidence}/07-${reason}-403-readonly.png`, fullPage: true });
  } finally { await page.unroute(`**/api/tasks/${taskId}/schedule`); for (const context of contexts) await context.close(); }
});
