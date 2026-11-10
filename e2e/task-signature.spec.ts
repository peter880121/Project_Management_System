import { businessToday } from "../src/modules/tasks/plan";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";

// Signature requests contain credentials; never persist network traces.
test.use({ trace: "off" });
const db = new PrismaClient();
const run = randomUUID();
const email = `signature-${run}@medpm.local`;
const title = "召开项目启动会";
const evidence = "test-results/signature-evidence";
let password: string; let projectId: string; let actorId: string;
let taskId: string; let drawerId: string;
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || "";
  if (!password) throw new Error("LOCAL_DEV_SEED_PASSWORD is required");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => {
    actorId = (await tx.user.create({ data: { email, name: "Synthetic signing PM", role: "PM", status: "ACTIVE", passwordHash } })).id;
    projectId = (await tx.project.create({ data: { name: "电子签名验收（合成数据）", ownerId: actorId } })).id;
    taskId = (await tx.task.create({ data: { projectId, title, status: "IN_PROGRESS" } })).id;
    drawerId = (await tx.task.create({ data: { projectId, title: "合成验证任务：测试通过", status: "IN_PROGRESS" } })).id;
  });
  await mkdir(evidence, { recursive: true });
});
test.afterAll(async () => {
  try { await db.$transaction(tx => tx.session.deleteMany({ where: { userId: actorId } })); }
  finally { await db.$disconnect(); }
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
});

test("card signing rejects missing/tampered signatures, returns 401 for wrong password, then saves a single audit", async ({ page }) => {
  test.setTimeout(90000);
  const url = `/api/tasks/${taskId}`;
  for (const data of [{ status: "DONE", completedAt: businessToday(), actualHours: 3 }, { status: "DONE", completedAt: businessToday(), actualHours: 3, signaturePassword: password, signatureReason: "tampered" }]) {
    expect((await page.request.patch(url, { data })).status()).toBe(400);
  }
  await page.goto(`/projects/${projectId}/board`);
  const card = page.locator(`[data-task-card="${taskId}"]`);
  await card.getByRole("button", { name: "完成", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "电子签名", exact: true });
  await expect(modal.getByText(`您正在签署任务：【${title}】，操作将变更为【已完成】`)).toBeVisible();
  await expect(modal.getByLabel("签名意图", { exact: true })).toHaveValue("确认任务已完成");
  await modal.getByLabel("签名意图", { exact: true }).selectOption("确认会议已完成");
  await modal.getByLabel("签名实际工时").fill("3");
  await page.screenshot({ path: `${evidence}/01-signature-modal.png`, fullPage: true });
  await modal.getByLabel("签名密码", { exact: true }).fill("Synthetic-wrong-password");
  await modal.getByRole("button", { name: "显示密码" }).click();
  await expect(modal.getByLabel("签名密码", { exact: true })).toHaveAttribute("type", "text");
  await modal.getByRole("button", { name: "隐藏密码" }).click();
  const rejected = page.waitForResponse(response => response.url().endsWith(url) && response.request().method() === "PATCH");
  await modal.getByRole("button", { name: "确认签署" }).click();
  const response = await rejected;
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "签名密码错误，请重新输入" });
  await expect(modal.getByLabel("操作反馈").getByRole("alert")).toContainText("签名密码错误，请重新输入");
  await expect(modal.getByLabel("签名密码", { exact: true })).toHaveValue("");
  await page.screenshot({ path: `${evidence}/02-signature-401-toast.png`, fullPage: true });
  await writeFile(`${evidence}/401-response.json`, JSON.stringify({ status: response.status(), body: await response.json() }, null, 2));
  await modal.getByLabel("操作反馈").getByRole("button", { name: "关闭提示", exact: true }).click();
  expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("IN_PROGRESS");
  expect(await db.auditLog.count({ where: { entityId: taskId } })).toBe(0);
  await modal.getByLabel("签名密码", { exact: true }).fill(password);
  await modal.getByLabel("签名意图", { exact: true }).selectOption("确认会议已完成");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let submissions = 0;
  await page.route(`**${url}`, async route => {
    if (route.request().method() === "PATCH") { submissions += 1; await held; }
    await route.continue();
  });
  await modal.getByRole("button", { name: "确认签署" }).click();
  await expect(modal.getByRole("button", { name: "正在签署…" })).toBeDisabled();
  await expect(modal.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(modal).toBeVisible();
  release();
  await expect(modal).toHaveCount(0);
  expect(submissions).toBe(1);
  await page.unroute(`**${url}`);
  await expect(page.getByRole("status").filter({ hasText: "已签署并保存" })).toBeVisible();
  await page.screenshot({ path: `${evidence}/03-signature-success-toast.png`, fullPage: true });
  const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: taskId, action: "TASK_SIGNED_AND_COMPLETED" } });
  expect(audit.actorId).toBe(actorId); expect(audit.after).toMatchObject({ status: "DONE", signatureReason: "确认会议已完成", actualHours: 3 });
  expect(JSON.stringify(audit)).not.toContain(password);
  expect((await page.request.patch(url, { data: { status: "DONE", completedAt: businessToday(), actualHours: 3, signaturePassword: password, signatureReason: "确认开发完成" } })).status()).toBe(409);
  expect(await db.auditLog.count({ where: { entityId: taskId } })).toBe(1);
});

test("drawer cancellation sends no PATCH; successful signing survives failed board/detail refresh", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto(`/projects/${projectId}/board`);
  await page.locator(`[data-task-card="${drawerId}"]`).getByRole("link").click();
  const drawer = page.getByRole("dialog", { name: "任务详情", exact: true });
  await drawer.getByRole("button", { name: "完成", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "电子签名", exact: true });
  await modal.getByLabel("签名密码", { exact: true }).fill("Synthetic-cancelled-password");
  await modal.getByRole("button", { name: "取消", exact: true }).click();
  expect((await db.task.findUniqueOrThrow({ where: { id: drawerId } })).status).toBe("IN_PROGRESS");
  await drawer.getByRole("button", { name: "完成", exact: true }).click();
  await expect(modal.getByLabel("签名密码", { exact: true })).toHaveValue("");
  await modal.getByLabel("签名实际工时").fill("2");
  await modal.getByLabel("签名密码", { exact: true }).fill(password);
  await modal.getByLabel("签名意图", { exact: true }).selectOption("确认测试通过");
  // Inject failure only into refresh GETs; signing reaches the real API and MySQL.
  await page.route(`**/api/projects/${projectId}/tasks`, route => route.fulfill({ status: 503, json: { error: "Synthetic refresh unavailable" } }));
  await page.route(`**/api/tasks/${drawerId}`, route => route.request().method() === "GET" ? route.fulfill({ status: 503, json: { error: "Synthetic detail unavailable" } }) : route.continue());
  await modal.getByRole("button", { name: "确认签署" }).click();
  await expect(modal).toHaveCount(0);
  await expect(drawer.getByLabel("操作反馈").getByRole("alert").filter({ hasText: "签署已成功，但数据刷新失败，请手动刷新" }).first()).toBeVisible();
  expect((await db.task.findUniqueOrThrow({ where: { id: drawerId } })).status).toBe("DONE");
  expect(await db.auditLog.count({ where: { entityId: drawerId, action: "TASK_SIGNED_AND_COMPLETED" } })).toBe(1);
  await page.screenshot({ path: `${evidence}/04-signed-refresh-failed.png`, fullPage: true });
});
