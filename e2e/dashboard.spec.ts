import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { PrismaClient, type Role } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";
import { sixMonthWindows } from "../src/modules/dashboard/calendar";
test.use({ trace: "off" });
const db = new PrismaClient(); const evidence = "test-results/dashboard-evidence";
const users = new Map<Role, { id: string; email: string }>(); let password: string; let ownId: string; let foreignId: string;
async function signIn(page: Page, role: Role) { expect((await page.request.post("/api/auth/login", { data: { email: users.get(role)!.email, password } })).status()).toBe(200); }
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || ""; if (!password) throw new Error("Synthetic password required"); const passwordHash = await hashPassword(password);
  await mkdir(evidence, { recursive: true });
  await db.$transaction(async tx => {
    for (const role of ["ADMIN", "PMO", "PM", "QA", "MEMBER"] as const) users.set(role, await tx.user.create({ data: { name: { ADMIN: "合成管理者", PMO: "合成 PMO 观察员", PM: "交付经理 · 陈", QA: "质量工程师 · 林", MEMBER: "开发工程师 · 周" }[role], email: `dashboard-${role}-${randomUUID()}@medpm.local`, passwordHash, status: "ACTIVE", role }, select: { id: true, email: true } }));
    const pm = users.get("PM")!.id; const qa = users.get("QA")!.id; const member = users.get("MEMBER")!.id;
    const completedAt = new Date();
    for (const [i, name] of ["医疗数据平台 · 验证交付", "院内接口平台 · 蓝图确认", "设备接入平台 · 系统验证"].entries()) {
      const p = await tx.project.create({ data: { name, status: "ACTIVE", ownerId: i === 2 ? users.get("ADMIN")!.id : pm } }); if (!i) ownId = p.id; if (i === 2) foreignId = p.id;
      const total = [10, 7, 5][i]; const done = [7, 2, 4][i];
      for (let n = 0; n < total; n++) {
        const task = await tx.task.create({ data: { projectId: p.id, title: `合成里程任务 ${i}-${n}`, status: n < done ? "DONE" : n === done ? "BLOCKED" : "IN_PROGRESS", completedAt: n < done ? completedAt : null, assigneeId: n % 3 === 0 ? qa : n % 3 === 1 ? member : pm, dueDate: n === done ? new Date(Date.now() - 86400000) : null } });
        if (n < done && !(i === 1 && n === 0)) await tx.auditLog.create({ data: { actorId: pm, projectId: p.id, entityType: "Task", entityId: task.id, action: "TASK_SIGNED_AND_COMPLETED", after: { status: "DONE", completedAt: completedAt.toISOString(), signatureReason: "确认任务已完成" } } });
      }
      await tx.aiSuggestion.createMany({ data: Array.from({ length: i + 1 }, () => ({ projectId: p.id, type: "RISK" as const, status: "PENDING" as const, input: {}, output: {}, createdAt: new Date() })) });
    }
    const months = sixMonthWindows(new Date());
    for (const [i, month] of months.entries()) {
      for (let n = 0; n < [1, 2, 1, 3, 2, 4][i]; n++) await tx.project.create({ data: { name: `合成历史交付 ${i}-${n}`, ownerId: pm, status: "ARCHIVED", archivedAt: new Date(month.start.getTime() + 86400000) } });
      for (let n = 0; n < [2, 4, 3, 6, 5, 8][i]; n++) {
        const d = await tx.document.create({ data: { projectId: ownId, filename: `synthetic-${i}-${n}.pdf`, minioKey: `synthetic/${randomUUID()}`, mediaType: "application/pdf" } }); const id = randomUUID();
        await tx.deliverable.create({ data: { id, seriesId: id, projectId: ownId, documentId: d.id, name: "合成交付版本", createdById: pm, createdAt: new Date(month.start.getTime() + 86400000) } });
      }
    }
  }, { timeout: 20000 });
});
test.afterAll(async () => { try { await db.$transaction(tx => tx.session.deleteMany({ where: { userId: { in: [...users.values()].map(u => u.id) } } })); } finally { await db.$disconnect(); } });

test("desktop PMO displays real aggregate cards, SVG tooltips, progress, trend and mobile layout", async ({ page }) => {
  test.setTimeout(90000); await signIn(page, "PMO"); await page.setViewportSize({ width: 1440, height: 1180 });
  await page.goto("/dashboard"); await expect(page.getByRole("region", { name: "项目组合关键指标" })).toBeVisible();
  await expect(page.getByText("全局项目视角", { exact: true })).toBeVisible(); await expect(page.getByRole("progressbar", { name: "医疗数据平台 · 验证交付 任务完成率" })).toHaveAttribute("aria-valuenow", "70");
  await expect(page.getByRole("img", { name: "近六个月交付趋势折线图", exact: true })).toBeVisible();
  const resources = page.getByRole("region", { name: "资源负荷矩阵" }); expect(await resources.locator("svg rect title").count()).toBeGreaterThan(0);
  const trend = page.getByRole("region", { name: "近六个月交付趋势" }); expect(await trend.locator("circle title").count()).toBe(12);
  expect(await trend.locator("polyline").evaluateAll(lines => lines.every(line => !/NaN|Infinity/.test(line.getAttribute("points") || "")))).toBe(true);
  await page.screenshot({ path: `${evidence}/01-desktop-dashboard.png`, fullPage: true });
  const rgb = await resources.locator("linearGradient stop").first().evaluate(el => getComputedStyle(el).stopColor); expect(rgb).not.toBe("rgb(0, 0, 0)");
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/02-mobile-dashboard.png`, fullPage: false });
  await trend.scrollIntoViewIfNeeded(); await expect(trend.getByRole("img")).toBeVisible();
  await page.screenshot({ path: `${evidence}/02b-mobile-trend.png`, fullPage: false });
});
test("PM injected project filter stays empty and QA/MEMBER are forbidden; PMO has no business writes", async ({ page }) => {
  await signIn(page, "PM"); const response = await page.request.get(`/api/dashboard/stats?projectId=${foreignId}&healthPage=2&loadPage=2`); expect(response.status()).toBe(200);
  const data = (await response.json()).data; expect(Object.values(data.metrics).every(v => v === 0)).toBe(true); expect(data.health.rows).toEqual([]); expect(data.workload.rows).toEqual([]);
  await page.goto(`/dashboard?projectId=${foreignId}`); await expect(page.getByText("暂无进行中的项目，新的交付旅程将在这里展开")).toBeVisible(); await expect(page.getByText("这六个月暂无归档或交付物版本记录，趋势将随交付逐步建立。")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1120 }); await page.screenshot({ path: `${evidence}/03-empty-dashboard.png`, fullPage: true });
  for (const role of ["QA", "MEMBER"] as const) { await signIn(page, role); expect((await page.request.get("/api/dashboard/stats?projectId=invalid")).status()).toBe(403); await page.goto("/dashboard"); await expect(page.getByRole("heading", { name: "无权访问数据决策中心" })).toBeVisible(); }
  await signIn(page, "PMO"); expect((await page.request.post("/api/projects", { data: { name: "Forbidden" } })).status()).toBe(403); expect((await page.request.patch(`/api/tasks/${randomUUID()}`, { data: { status: "IN_PROGRESS" } })).status()).toBe(403);
  expect((await page.request.get("/api/auth/me")).status()).toBe(200); expect((await page.request.post("/api/users", { data: {} })).status()).toBe(403);
});
test("error state clears stale statistics and a retry recovers, including mid-page role revocation", async ({ page }) => {
  await signIn(page, "PMO"); await page.goto("/dashboard"); await expect(page.getByRole("region", { name: "项目组合关键指标" })).toBeVisible();
  await page.route("**/api/dashboard/stats?*", route => route.fulfill({ status: 503, json: { error: "统计数据暂时不可用，请重试" } }));
  await page.getByRole("button", { name: "刷新数据", exact: true }).click(); await expect(page.getByRole("alert", { name: "dashboard-error", exact: true })).toContainText("统计数据暂时不可用"); await expect(page.getByRole("region", { name: "项目组合关键指标" })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: `${evidence}/04-error-dashboard.png`, fullPage: true });
  await page.unroute("**/api/dashboard/stats?*"); await page.getByRole("button", { name: "重试加载", exact: true }).click(); await expect(page.getByRole("region", { name: "项目组合关键指标" })).toBeVisible();
  await db.$transaction(tx => tx.user.update({ where: { id: users.get("PMO")!.id }, data: { role: "QA" } }));
  try { await page.getByRole("button", { name: "刷新数据", exact: true }).click(); await expect(page.getByRole("alert", { name: "dashboard-error", exact: true })).toContainText("权限已变更"); await expect(page.getByRole("region", { name: "项目组合关键指标" })).toHaveCount(0); }
  finally { await db.$transaction(tx => tx.user.update({ where: { id: users.get("PMO")!.id }, data: { role: "PMO" } })); }
});
