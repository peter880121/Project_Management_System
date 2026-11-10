import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { chromium, request, expect } from "@playwright/test";

// Read-only business smoke check. Only authenticated login/logout/download audits are written.
const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!/^medpm_demo_hospital_\d{8}_[a-f0-9]{8}$/.test(dbName)) throw new Error("Only a prepared hospital demo may be verified");
const db = new PrismaClient(); const baseURL = "http://localhost:4000";
const projectCount = process.argv.includes("--with-standard-projects") ? 3 : 1;
const captureEvidence = process.env.E2E_CAPTURE_EVIDENCE === "1";
let browser;
const contexts = []; const pageErrors = []; const failedHttp = [];
try {
  const project = await db.project.findFirstOrThrow({ where: { name: "XX市第一人民医院EMR系统交付" } });
  const before = { projects: await db.project.count(), tasks: await db.task.count(), deliverables: await db.deliverable.count(), meetings: await db.meetingRecord.count() };
  assert.deepEqual(before, { projects: projectCount, tasks: projectCount * 14, deliverables: 3, meetings: 1 });
  const users = await db.user.findMany({ where: { isSystem: false }, select: { id: true, role: true, email: true, passwordHash: true } });
  assert.equal(users.length, 4);
  const password = process.env.LOCAL_DEV_SEED_PASSWORD;
  for (const user of users) assert.ok(password && await bcrypt.compare(password, user.passwordHash), "Existing account password differs from local demo password; do not reset it automatically");
  const clients = new Map();
  for (const user of users) {
    const client = await request.newContext({ baseURL, userAgent: "MedPM hospital demo verification" }); contexts.push(client);
    const login = await client.post("/api/auth/login", { data: { email: user.email, password } }); assert.equal(login.status(), 200, "Base account must log in"); clients.set(user.role, client);
  }
  const pm = clients.get("PM");
  const tasks = await db.task.findMany({ where: { projectId: project.id }, include: { dependencies: true, deliverables: true }, orderBy: { plannedStartDate: "asc" } });
  assert.equal(tasks.filter(t => t.status === "DONE").length, 6); assert.equal(tasks.filter(t => t.status === "IN_PROGRESS").length, 1); assert.equal(tasks.filter(t => t.status === "TODO").length, 7);
  assert.equal(tasks.flatMap(t => t.dependencies).length, 13);
  for (const task of tasks) {
    assert.ok(task.assigneeId && task.requirementId && task.plannedStartDate <= task.dueDate);
    if (task.status === "DONE") {
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: task.id, action: "TASK_SIGNED_AND_COMPLETED" } });
      assert.equal(audit.after.completedAt, task.completedAt.toISOString());
      if (task.requiresDeliverable) assert.ok(task.deliverables.some(d => d.status === "APPROVED"));
    }
  }
  const deliveries = await db.deliverable.findMany({ where: { projectId: project.id }, include: { document: true } });
  for (const item of deliveries) {
    assert.equal(item.status, "APPROVED"); assert.notEqual(item.createdById, item.reviewedById);
    const response = await clients.get("QA").get(`/api/documents/${item.documentId}/download`); assert.equal(response.status(), 200, "PDF download must work through the real app");
    assert.equal(createHash("sha256").update(await response.body()).digest("hex"), item.document.sha256);
  }
  assert.equal(await db.syncFailure.count(), 0); assert.equal(await db.documentChunk.count({ where: { vectorStatus: { not: "SYNCED" } } }), 0);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: await pm.storageState(), viewport: { width: 1600, height: 1050 } });
  const page = await context.newPage(); page.on("pageerror", error => pageErrors.push(error.message)); page.on("response", r => { if (r.url().startsWith(baseURL) && r.status() >= 400) failedHttp.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  mkdirSync("output/environment", { recursive: true });
  if (captureEvidence) mkdirSync("test-results/hospital-demo", { recursive: true });
  for (const route of ["board", "planning", "deliverables", "meetings", "acceptance", "members", "settings"]) {
    const response = await page.goto(`${baseURL}/projects/${project.id}/${route}`); assert.equal(response.status(), 200);
    if (route === "board") await expect(page.getByRole("region", { name: "任务看板", exact: true })).toHaveAttribute("aria-busy", "false");
    if (route === "deliverables") await expect(page.getByText("需求规格说明书", { exact: true })).toBeVisible();
    if (route === "meetings") { await page.getByRole("button", { name: /EMR项目周例会/ }).click(); await expect(page.getByText("补齐EMR接口重复消息与超时恢复的SIT测试清单", { exact: true })).toBeVisible(); }
    if (captureEvidence && ["board", "deliverables", "meetings"].includes(route)) await page.screenshot({ path: `test-results/hospital-demo/${route}.png`, fullPage: true });
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(failedHttp, []);
  const after = { projects: await db.project.count(), tasks: await db.task.count(), deliverables: await db.deliverable.count(), meetings: await db.meetingRecord.count() }; assert.deepEqual(after, before);
  const result = { verified: true, baseAccountLogins: users.length, pages: 7, downloadableApprovedPdfs: deliveries.length, taskDependencies: 13, syncedChunks: await db.documentChunk.count(), pageErrors, failedHttp, businessDataUnchanged: true };
  writeFileSync("output/environment/verification.json", JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  for (const client of contexts) { try { await client.post("/api/auth/logout"); } finally { await client.dispose(); } }
  await db.$disconnect();
}
