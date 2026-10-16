import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";
const db = new PrismaClient(); const runId = randomUUID();
const email = `rag-qa-${runId}@medpm.local`; const pmEmail = `rag-pm-${runId}@medpm.local`; let password: string; let projectId: string; let documentId: string;
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || ""; if (!password) throw new Error("Set LOCAL_DEV_SEED_PASSWORD for RAG E2E");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const qa = await tx.user.create({ data: { email, name: "Synthetic RAG QA", role: "QA", status: "ACTIVE", passwordHash } });
    const pm = await tx.user.create({ data: { email: pmEmail, name: "Synthetic RAG PM", role: "PM", status: "ACTIVE", passwordHash } });
    projectId = (await tx.project.create({ data: { name: "Synthetic RAG browser acceptance", ownerId: pm.id } })).id;
    await tx.projectMember.create({ data: { projectId, userId: qa.id } });
    // Synthetic normalized parse fixture. Live MinerU and MinIO have their own acceptance test.
    const text = `Synthetic document acceptance ${runId}`;
    documentId = (await tx.document.create({ data: { projectId, filename: `synthetic-rag-${runId}.pdf`, minioKey: `synthetic-fixture/${runId}`, mediaType: "application/pdf", storageStatus: "AVAILABLE", parseStatus: "SUCCEEDED", parseVersion: 1, parsedVersion: 1, parsedAt: new Date(), parsedText: text } })).id;
    await tx.documentParseJob.create({ data: { documentId, version: 1, requestedById: qa.id, requestKey: randomUUID(), status: "SUCCEEDED", modelVersion: "synthetic-fixture", sourceSha256: "a".repeat(64), sourceFilename: "synthetic.pdf", sourceSize: 1, deadlineAt: new Date(), markdown: text, blocks: [{ text, page: 3, type: "text" }], completedAt: new Date() } });
  });
});
test.afterAll(async () => { try { await db.$transaction((tx) => tx.session.deleteMany({ where: { user: { email: { in: [email, pmEmail] } } } })); } finally { await db.$disconnect(); } });
test("QA retrieves a chunk, follows its versioned source and cannot retry indexing", async ({ page }) => {
  test.setTimeout(90000);
  expect((await page.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  await expect.poll(async () => (await db.document.findUniqueOrThrow({ where: { id: documentId } })).chunkedVersion, { timeout: 45000 }).toBe(1);
  await page.goto(`/projects/${projectId}/documents`);
  await page.getByLabel("文档检索词", { exact: true }).fill(runId);
  await page.getByRole("button", { name: "检索文档", exact: true }).click();
  const link = page.getByRole("link", { name: `synthetic-rag-${runId}.pdf · v1 · 第 3 页 · 分块 1`, exact: true });
  await expect(link).toBeVisible({ timeout: 15000 }); await link.click();
  await expect(page.getByRole("heading", { name: `文档引用 · synthetic-rag-${runId}.pdf` })).toBeVisible();
  await expect(page.locator("pre")).toContainText(`Synthetic document acceptance ${runId}`);
  await expect(page.getByText(/解析版本 v1/)).toBeVisible();
  expect((await page.request.post(`/api/documents/${documentId}/index`, { data: { version: 1 } })).status()).toBe(403);
  const chunk = await db.documentChunk.findFirstOrThrow({ where: { documentId } });
  expect((await page.request.get(`/projects/${randomUUID()}/documents/chunks/${chunk.id}`)).status()).toBe(404);
  expect(await db.auditLog.count({ where: { projectId, action: "RAG_SEARCH" } })).toBe(1);
  const audit = await db.auditLog.findFirstOrThrow({ where: { projectId, action: "RAG_SEARCH" } }); expect(audit.after).toMatchObject({ query: runId, hitIds: [chunk.id], source: "documents" });
});
test("PM reloads stored WBS evidence and explicitly accepts the pending task", async ({ page }) => {
  test.setTimeout(60000);
  await expect.poll(async () => (await db.document.findUniqueOrThrow({ where: { id: documentId } })).chunkedVersion, { timeout: 45000 }).toBe(1);
  const chunk = await db.documentChunk.findFirstOrThrow({ where: { documentId } });
  const suggestion = await db.$transaction((tx) => tx.aiSuggestion.create({ data: { projectId, type: "WBS", status: "PENDING", input: {
    retrievalHitIds: [], documentEvidence: [{ id: chunk.id, documentId, version: 1, page: 3, text: chunk.text, textSha256: chunk.textSha256, filename: `synthetic-rag-${runId}.pdf` }],
  }, output: { title: `Synthetic WBS evidence ${runId}`, description: "Synthetic acceptance evidence requires QA review", estimateHours: 3, suggestedRole: "QA", dependencyIds: [], dependencyTitles: [], sourceChunkIds: [chunk.id] } } }));
  expect((await page.request.post("/api/auth/login", { data: { email: pmEmail, password } })).status()).toBe(200);
  await page.goto(`/projects/${projectId}/board`); await page.reload();
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: `Synthetic WBS evidence ${runId}`, exact: true }) });
  await expect(card.getByText("提供给模型的文档证据", { exact: true })).toBeVisible();
  await expect(card.getByText("模型引用了此片段，需人工核对", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: `synthetic-rag-${runId}.pdf · v1 · 第 3 页`, exact: true })).toHaveAttribute("href", `/projects/${projectId}/documents/chunks/${chunk.id}`);
  expect(await db.task.count({ where: { projectId } })).toBe(0);
  await card.getByRole("button", { name: "采纳为任务", exact: true }).click();
  await expect.poll(() => db.task.count({ where: { projectId } })).toBe(1);
  expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).status).toBe("ACCEPTED");
  expect(await db.auditLog.count({ where: { entityId: suggestion.id, action: "AI_SUGGESTION_ACCEPTED" } })).toBe(1);
});
