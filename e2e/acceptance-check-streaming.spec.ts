import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";
test.skip(!process.env.AI_STREAM_FIXTURE_URL, "Requires the isolated LangChain streaming fixture");
test.use({ trace: "off", viewport: { width: 1440, height: 1000 } });
const db = new PrismaClient(); const evidence = "test-results/acceptance-check-evidence";
let password: string, projectId: string, pmId: string, adminId: string, qaId: string, pmEmail: string, adminEmail: string, qaEmail: string, taskId: string, doneId: string, meetingId: string;
const date = new Date("2026-10-19T03:00:00.123Z");
const control = (mode: string) => fetch(`${process.env.AI_STREAM_FIXTURE_URL}/__fixture/control?mode=${mode}`, { method: "POST" }).then(r => r.json()) as Promise<{ started: number; cancelled: number }>;
async function login(request: APIRequestContext, email: string) { expect((await request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200); }
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || ""; if (!password) throw new Error("Synthetic password required"); const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => { const users = []; for (const role of ["PM", "ADMIN", "QA"] as const) users.push(await tx.user.create({ data: { email: `precheck-${role}-${randomUUID()}@medpm.local`, name: `合成结项 ${role}`, role, status: "ACTIVE", passwordHash } })); [pmId, adminId, qaId] = users.map(u => u.id); [pmEmail, adminEmail, qaEmail] = users.map(u => u.email); }); await mkdir(evidence, { recursive: true });
});
test.beforeEach(async ({ page }) => {
  await db.$transaction(async tx => {
    await tx.user.update({ where: { id: pmId }, data: { role: "PM" } }); projectId = (await tx.project.create({ data: { name: "医疗交付结项体检（合成项目）", ownerId: pmId, status: "ACTIVE" } })).id;
    await tx.projectMember.createMany({ data: [qaId, adminId].map(userId => ({ projectId, userId })) });
    taskId = (await tx.task.create({ data: { projectId, title: "需求规格说明书确认", description: "所属阶段：需求与蓝图", requiresDeliverable: true } })).id;
    doneId = (await tx.task.create({ data: { projectId, title: "合成接口联调", description: "所属阶段：开发与配置", status: "DONE", completedAt: date, actualHours: 2 } })).id;
    meetingId = (await tx.meetingRecord.create({ data: { projectId, title: "合成验收准备会", content: "明确整改责任，所有数据均为合成。", meetingDate: date, createdById: pmId, requestKey: randomUUID(), visibleRoles: ["PM"], actionItems: [{ id: randomUUID(), text: "落实验收证据复核", checked: true }] } })).id;
  }); await login(page.request, pmEmail); await control("normal");
});
test.afterAll(async () => { try { await db.$transaction(tx => tx.session.deleteMany({ where: { userId: { in: [pmId, adminId, qaId] } } })); } finally { await db.$disconnect(); } });
test("streams a factual report, accepts an explicit ADMIN-granted exception and shows a risk banner on board", async ({ page, browser }) => {
  test.setTimeout(120000); const admin = await browser.newContext({ baseURL: process.env.E2E_BASE_URL }); const qa = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  try {
    await login(admin.request, adminEmail); await login(qa.request, qaEmail);
    expect((await admin.request.put(`/api/projects/${projectId}/members`, { data: { userId: pmId, active: true, expectedVersion: 0, canOverrideAcceptance: true } })).status()).toBe(200);
    await control("hold");
    await page.goto(`/projects/${projectId}/acceptance`); await page.getByRole("button", { name: "🩺 AI 结项体检", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "AI 结项合规体检", exact: true }); const report = drawer.getByRole("region", { name: "流式诊断报告" });
    await expect(report.getByText(/数据库已确认存在/)).toBeVisible({ timeout: 20000 }); await expect(drawer.getByRole("button", { name: "停止生成" })).toBeVisible();
    const previous = await report.locator("p").last().textContent(); await expect.poll(() => report.locator("p").last().textContent()).not.toBe(previous);
    await page.screenshot({ path: `${evidence}/01-streaming-diagnosis.png` });
    await control("release");
    await expect(drawer.getByText("发现 4 个合规缺口，当前不可正常提交验收", { exact: true })).toBeVisible({ timeout: 45000 });
    await expect(report).toContainText("当前完成轮次缺少电子签名：1 项"); await expect(report).not.toContainText("完全合规");
    const row = await db.projectComplianceCheck.findFirstOrThrow({ where: { projectId } }); expect(row.passed).toBe(false); expect(await db.auditLog.count({ where: { entityId: row.id, action: "PROJECT_COMPLIANCE_CHECKED" } })).toBe(1);
    const ai = await db.aiSuggestion.findUniqueOrThrow({ where: { id: row.id } }); expect(ai.status).toBe("PENDING"); expect((ai.output as { degraded: boolean }).degraded).toBe(false);
    await drawer.getByRole("button", { name: /未转任务的会议行动项/ }).click(); await expect(drawer.getByRole("region", { name: "缺口证据明细" }).getByRole("link")).toHaveAttribute("href", `/projects/${projectId}/meetings?meetingId=${meetingId}`);
    await drawer.getByRole("button", { name: "关闭体检抽屉" }).click(); await page.getByRole("button", { name: "特权带风险提交", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "特权风险提交", exact: true }); await dialog.getByLabel("特权说明", { exact: true }).fill("本次为合成项目，申请先行送交 QA 确认整改范围，由 PM 负责补齐交付物、签名与行动项后重新正式提交，不豁免最终归档条件。"); await dialog.getByRole("checkbox").check();
    await page.screenshot({ path: `${evidence}/02-override-reason.png` }); await dialog.getByRole("button", { name: "确认带风险提交", exact: true }).click();
    await expect(page.getByText("⚠️ 带风险待审（存在 4 个合规缺口）", { exact: true }).first()).toBeVisible();
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } }); expect(project.status).toBe("PENDING_ACCEPTANCE");
    const acceptance = await db.projectAcceptance.findUniqueOrThrow({ where: { id: project.currentAcceptanceId! } }); expect(acceptance.overrideGapCount).toBe(4); expect(acceptance.overrideCheckId).toBe(row.id);
    expect((await qa.request.post(`/api/projects/${projectId}/qa-approve`, { data: { expectedRowVersion: 2, acceptanceId: acceptance.id, requestKey: randomUUID() } })).status()).toBe(400);
    expect((await admin.request.post(`/api/projects/${projectId}/archive`, { data: { expectedRowVersion: 2, acceptanceId: acceptance.id, requestKey: randomUUID() } })).status()).toBe(400);
    await page.goto(`/projects/${projectId}/board`); await expect(page.getByText("⚠️ 带风险待审（存在 4 个合规缺口）", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "任务看板", exact: true })).toHaveAttribute("aria-busy", "false");
    await expect(page.getByText("需求规格说明书确认", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/03-risk-pending-board.png` });
  } finally { await admin.close(); await qa.close(); }
});
test("pass returns JSON without an LLM call; changed evidence shows the exact expiry modal", async ({ page }) => {
  test.setTimeout(90000);
  await db.$transaction(async tx => {
    await tx.task.update({ where: { id: taskId }, data: { status: "DONE", completedAt: date, actualHours: 1 } });
    const doc = await tx.document.create({ data: { projectId, filename: "synthetic-spec.pdf", mediaType: "application/pdf", minioKey: `synthetic/${randomUUID()}`, sha256: "a".repeat(64), storageStatus: "AVAILABLE" } }); const id = randomUUID(); await tx.deliverable.create({ data: { id, seriesId: id, projectId, taskId, documentId: doc.id, name: "合成规格说明书", status: "APPROVED", createdById: pmId, reviewedById: qaId } });
    for (const entityId of [taskId, doneId]) await tx.auditLog.create({ data: { projectId, actorId: pmId, action: "TASK_SIGNED_AND_COMPLETED", entityType: "Task", entityId, after: { status: "DONE", signatureReason: "确认任务已完成", completedAt: date.toISOString() } } });
    await tx.meetingRecord.update({ where: { id: meetingId }, data: { actionItems: [{ id: randomUUID(), text: "落实验收复核", checked: true, taskId }] } });
  });
  const baseline = await control("normal"); await page.goto(`/projects/${projectId}/acceptance`); const responsePromise = page.waitForResponse(r => r.url().endsWith(`/api/projects/${projectId}/acceptance-check`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "🩺 AI 结项体检", exact: true }).click(); const response = await responsePromise; expect(await response.json()).toEqual({ passed: true, message: "合规检查通过，可提交验收" });
  const drawer = page.getByRole("dialog", { name: "AI 结项合规体检" }); await expect(drawer.getByText("合规检查通过，可提交验收", { exact: true }).first()).toBeVisible(); expect((await control("normal")).started).toBe(baseline.started);
  await drawer.getByRole("button", { name: "关闭体检抽屉" }).click(); expect((await page.request.patch(`/api/tasks/${doneId}`, { data: { status: "IN_PROGRESS", expectedRowVersion: (await db.task.findUniqueOrThrow({ where: { id: doneId } })).rowVersion } })).status()).toBe(200);
  await page.goto(`/projects/${projectId}/acceptance`); await page.getByRole("button", { name: "提交验收", exact: true }).click(); const modal = page.getByRole("dialog", { name: "体检结果已失效", exact: true });
  await expect(modal.getByText("体检结果已失效（因为数据被修改），请重新体检。", { exact: true })).toBeVisible(); await page.screenshot({ path: `${evidence}/04-expired-check.png` }); expect(await db.projectAcceptance.count({ where: { projectId } })).toBe(0);
});
test("closing the drawer aborts the provider but retains the rule-check audit; PM cannot forge override", async ({ page }) => {
  test.setTimeout(90000); const baseline = await control("hold"); await page.goto(`/projects/${projectId}/board`); await page.getByRole("button", { name: "🩺 AI 结项体检", exact: true }).click(); const drawer = page.getByRole("dialog", { name: "AI 结项合规体检" });
  await expect(drawer.getByText(/数据库已确认存在/)).toBeVisible({ timeout: 20000 }); await drawer.getByRole("button", { name: "关闭体检抽屉" }).click();
  await expect.poll(async () => (await control("hold")).cancelled).toBeGreaterThan(baseline.cancelled);
  const check = await db.projectComplianceCheck.findFirstOrThrow({ where: { projectId } }); expect(await db.auditLog.count({ where: { entityId: check.id, action: "PROJECT_COMPLIANCE_CHECKED" } })).toBe(1); expect(await db.aiSuggestion.count({ where: { projectId, type: "ACCEPTANCE_DIAGNOSIS" } })).toBe(0);
  const response = await page.request.post(`/api/projects/${projectId}/submit-acceptance`, { data: { expectedRowVersion: 1, requestKey: randomUUID(), checkId: check.id, override: true, overrideReason: "这是伪造权限的合成请求，普通项目经理没有经过 ADMIN 项目授权，必须拒绝。" } }); expect(response.status()).toBe(403);
  await page.goto(`/projects/${projectId}/meetings?meetingId=${meetingId}`);
  await page.getByRole("button", { name: "转为任务", exact: true }).click();
  const taskDialog = page.getByRole("dialog", { name: "行动项转为任务", exact: true });
  await taskDialog.getByLabel("预计工时", { exact: true }).fill("4");
  await taskDialog.getByLabel("负责人", { exact: true }).selectOption(pmId); await taskDialog.getByRole("checkbox").check();
  await taskDialog.getByRole("button", { name: "确认创建任务", exact: true }).click();
  await expect(page.getByRole("link", { name: /已转任务/ }).first()).toBeVisible();
  const finalized = await db.meetingRecord.findUniqueOrThrow({ where: { id: meetingId } });
  expect(finalized.status).toBe("FINALIZED"); expect(finalized.content).toBe("明确整改责任，所有数据均为合成。");
  expect(finalized.actionItems).toMatchObject([{ checked: true, taskId: expect.any(String) }]);
});
test("hallucinated positive verdicts are blocked and deterministic findings survive model failure", async ({ page }) => {
  test.setTimeout(90000); await control("hallucination"); await page.goto(`/projects/${projectId}/acceptance`); await page.getByRole("button", { name: "🩺 AI 结项体检", exact: true }).click(); const drawer = page.getByRole("dialog", { name: "AI 结项合规体检" });
  await expect(drawer.getByText("发现 4 个合规缺口，当前不可正常提交验收", { exact: true })).toBeVisible({ timeout: 45000 }); await expect(drawer.getByRole("region", { name: "流式诊断报告" })).not.toContainText(/完全合规|可以提交验收/);
  const result = await db.aiSuggestion.findFirstOrThrow({ where: { projectId, type: "ACCEPTANCE_DIAGNOSIS" } }); expect((result.output as { degraded: boolean }).degraded).toBe(true); expect(JSON.stringify(result.output)).not.toContain("完全合规");
});
test("mid-stream role revocation stops the report commit and refreshes capabilities", async ({ page }) => {
  test.setTimeout(90000); await control("hold"); await page.goto(`/projects/${projectId}/acceptance`); await page.getByRole("button", { name: "🩺 AI 结项体检", exact: true }).click(); const drawer = page.getByRole("dialog", { name: "AI 结项合规体检" }); await expect(drawer.getByText(/数据库已确认存在/)).toBeVisible({ timeout: 20000 });
  await db.$transaction(tx => tx.user.update({ where: { id: pmId }, data: { role: "MEMBER" } })); await control("release"); await expect(page.getByRole("alert").filter({ hasText: /权限或会话已变化|权限已变更/ }).first()).toBeVisible({ timeout: 45000 });
  expect(await db.projectComplianceCheck.count({ where: { projectId } })).toBe(1); expect(await db.aiSuggestion.count({ where: { projectId, type: "ACCEPTANCE_DIAGNOSIS" } })).toBe(0);
});
