import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";
const db = new PrismaClient(); const runId = randomUUID();
const emails = [`documents-test-${runId}-pm@medpm.local`, `documents-test-${runId}-qa@medpm.local`];
let password: string; let projectId: string;
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || ""; if (!password) throw new Error("Set LOCAL_DEV_SEED_PASSWORD for document E2E");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const pm = await tx.user.create({ data: { email: emails[0], name: "Synthetic uploader", passwordHash, role: "PM", status: "ACTIVE" } });
    const qa = await tx.user.create({ data: { email: emails[1], name: "Synthetic QA", passwordHash, role: "QA", status: "ACTIVE" } });
    projectId = (await tx.project.create({ data: { name: "Synthetic document acceptance", ownerId: pm.id } })).id;
    await tx.projectMember.create({ data: { projectId, userId: qa.id } });
  });
});
test.afterAll(async () => { try { await db.$transaction((tx) => tx.session.deleteMany({ where: { user: { email: { in: emails } } } })); } finally { await db.$disconnect(); } });
test("PM uploads through S3 SDK; QA downloads identical bytes with audit; failures remain recoverable", async ({ page }) => {
  test.setTimeout(90000);
  expect((await page.request.post("/api/auth/login", { data: { email: emails[0], password } })).status()).toBe(200);
  await page.goto(`/projects/${projectId}/documents`);
  await page.getByLabel("选择 PDF", { exact: true }).setInputFiles({ name: "合成需求.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("checkbox", { name: "确认文件仅含合成数据，不含真实患者信息", exact: true }).check(); await page.getByRole("button", { name: "上传文档", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("文档已保存", { timeout: 20000 });
  const document = page.locator("article").filter({ has: page.getByRole("heading", { name: "合成需求.pdf", exact: true }) });
  await expect(document.getByText(/可下载/)).toBeVisible();
  const id = (await document.getByRole("link", { name: "下载原文件", exact: true }).getAttribute("href"))!.split("/").at(-2)!;
  expect((await page.request.post("/api/auth/logout")).status()).toBe(200);
  expect((await page.request.post("/api/auth/login", { data: { email: emails[1], password } })).status()).toBe(200);
  await page.reload(); await expect(page.getByRole("button", { name: "上传文档", exact: true })).toHaveCount(0);
  const response = await page.request.get(`/api/documents/${id}/download`); expect(response.status()).toBe(200); expect(await response.body()).toEqual(pdf);
  const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: id, action: "DATA_EXPORTED" } }); expect(audit.after).toMatchObject({ scope: { projectId, documentIds: [id] } });
  // Failure injection is available only in the explicit protocol-fixture runner.
  const fixture = process.env.DOCUMENT_E2E_STORAGE_URL;
  if (fixture) {
    expect((await page.request.post("/api/auth/logout")).status()).toBe(200);
    expect((await page.request.post("/api/auth/login", { data: { email: emails[0], password } })).status()).toBe(200);
    await fetch(`${fixture}/__fixture/fail-writes?enabled=true`, { method: "POST" });
    try {
      await page.reload(); await page.getByLabel("选择 PDF", { exact: true }).setInputFiles({ name: "失败合成.pdf", mimeType: "application/pdf", buffer: pdf }); await page.getByRole("checkbox", { name: "确认文件仅含合成数据，不含真实患者信息", exact: true }).check(); await page.getByRole("button", { name: "上传文档", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("文档上传未完成", { timeout: 20000 });
      await expect(page.locator("article").filter({ hasText: "失败合成.pdf" }).getByText(/上传失败/)).toBeVisible();
    } finally { await fetch(`${fixture}/__fixture/fail-writes?enabled=false`, { method: "POST" }); }
  }
});
