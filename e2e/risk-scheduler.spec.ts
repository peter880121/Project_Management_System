import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";
const db = new PrismaClient(); const runId = randomUUID(); const email = `auto-risk-${runId}@medpm.local`; const otherEmail = `auto-risk-other-${runId}@medpm.local`;
let password: string; let projectId: string; let taskId: string; let actorId: string; const title = `Synthetic automatic risk ${runId}`;
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || ""; if (!password) throw new Error("Set LOCAL_DEV_SEED_PASSWORD for risk E2E"); const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    actorId = (await tx.user.create({ data: { email, name: "Synthetic risk scheduler PM", role: "PM", status: "ACTIVE", passwordHash } })).id;
    await tx.user.create({ data: { email: otherEmail, name: "Synthetic unrelated risk PM", role: "PM", status: "ACTIVE", passwordHash } });
    projectId = (await tx.project.create({ data: { name: "Synthetic auto risk browser acceptance", ownerId: actorId } })).id;
    taskId = (await tx.task.create({ data: { projectId, title, dueDate: new Date("2026-01-01") } })).id;
  });
});
test.afterAll(async () => { try { await db.$transaction(async (tx) => { await tx.session.deleteMany({ where: { user: { email: { in: [email, otherEmail] } } } }); if (projectId) await tx.riskScanSchedule.updateMany({ where: { projectId }, data: { enabled: false } }); }); } finally { await db.$disconnect(); } });
test("PM enables automatic scanning, receives private audited notification, and marks it read", async ({ page }) => {
  test.setTimeout(90000);
  expect((await page.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  await page.goto(`/projects/${projectId}/risks`);
  await page.getByLabel("启用自动风险扫描", { exact: true }).check(); await page.getByRole("button", { name: "保存扫描计划", exact: true }).click();
  await expect.poll(async () => db.riskScanJob.count({ where: { projectId, status: "SUCCEEDED" } }), { timeout: 45000 }).toBe(1);
  expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("TODO");
  await page.goto("/projects"); await expect(page.getByRole("link", { name: /风险通知（1 未读）/ })).toBeVisible();
  await page.getByRole("link", { name: /风险通知（1 未读）/ }).click();
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(card).toBeVisible(); const notification = await db.riskNotification.findFirstOrThrow({ where: { userId: actorId, suggestion: { projectId } } });
  await card.getByRole("link", { name: "查看风险依据", exact: true }).click(); await expect(page.getByRole("heading", { name: "风险通知详情", exact: true })).toBeVisible(); await expect(page.getByText(/任务尚未完成/)).toBeVisible();
  await page.goto("/notifications"); await card.getByRole("button", { name: "标为已读", exact: true }).click(); await expect(page.getByText("未读通知：0", { exact: true })).toBeVisible();
  expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: notification.suggestionId } })).status).toBe("PENDING");
  expect(await db.auditLog.count({ where: { entityId: notification.id, action: "RISK_NOTIFICATION_READ" } })).toBe(1);
  const suggestionIds = await db.aiSuggestion.findMany({ where: { projectId }, select: { id: true } }); expect(suggestionIds).toHaveLength(1);
  await page.request.post("/api/auth/logout"); expect((await page.request.post("/api/auth/login", { data: { email: otherEmail, password } })).status()).toBe(200);
  expect((await (await page.request.get("/api/notifications")).json()).data).toEqual([]);
  expect((await page.request.post(`/api/notifications/${notification.id}/read`)).status()).toBe(403);
  expect((await page.request.get(`/notifications/${notification.id}`)).status()).toBe(404);
});
