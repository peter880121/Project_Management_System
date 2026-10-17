import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";
const db = new PrismaClient(); const run = randomUUID(); const emails = [`export-owner-${run}@medpm.local`, `export-qa-${run}@medpm.local`, `export-other-${run}@medpm.local`];
let password: string; let projectId: string; let qaId: string; let taskId: string; let hidden: string;
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || ""; if (!password) throw new Error("Set LOCAL_DEV_SEED_PASSWORD"); const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const users = [];
    for (const [index, role] of (["PM", "QA", "PM"] as const).entries()) users.push(await tx.user.create({ data: { email: emails[index], name: `Synthetic export ${index}`, role, status: "ACTIVE", passwordHash } }));
    qaId = users[1].id;
    projectId = (await tx.project.create({ data: { name: `Synthetic scoped export ${run}`, ownerId: users[0].id } })).id;
    hidden = (await tx.project.create({ data: { name: `Synthetic hidden export ${run}`, ownerId: users[2].id } })).id;
    taskId = (await tx.task.create({ data: { projectId, title: "=Synthetic spreadsheet formula" } })).id;
    await tx.task.create({ data: { projectId: hidden, title: "HIDDEN_SYNTHETIC_EXPORT_TASK" } });
  });
});
test.afterAll(async () => { try { await db.$transaction((tx) => tx.session.deleteMany({ where: { user: { email: { in: emails } } } })); } finally { await db.$disconnect(); } });
test("owner grants QA access, QA downloads audited CSV/JSON, and revocation blocks direct URLs", async ({ page, browser }) => {
  test.setTimeout(120000);
  expect((await page.request.post("/api/auth/login", { data: { email: emails[0], password } })).status()).toBe(200);
  await page.goto(`/projects/${projectId}/members`); await page.getByLabel("待添加成员").selectOption(qaId); await page.getByRole("button", { name: "添加成员", exact: true }).click();
  const memberRow = page.getByRole("table", { name: "项目成员列表", exact: true }).getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Synthetic export 1", exact: true }) }).filter({ has: page.getByRole("cell", { name: "QA", exact: true }) });
  await expect(memberRow).toBeVisible();
  const qa = await browser.newContext({ baseURL: new URL(page.url()).origin }); const qaPage = await qa.newPage();
  try {
    expect((await qa.request.post("/api/auth/login", { data: { email: emails[1], password } })).status()).toBe(200);
    expect((await qa.request.get(`/api/projects/${hidden}/tasks`)).status()).toBe(403);
    await qaPage.goto(`/projects/${projectId}/exports`); await expect(qaPage.getByRole("heading", { name: "合规证据导出" })).toBeVisible();
    for (const format of ["csv", "json"]) {
      await qaPage.getByLabel("导出格式").selectOption(format);
      const downloadPromise = qaPage.waitForEvent("download"); await qaPage.getByRole("button", { name: "生成并下载", exact: true }).click(); const download = await downloadPromise;
      const path = await download.path(); expect(path).toBeTruthy(); const bytes = await readFile(path!); const text = bytes.toString();
      expect(text).toContain(taskId); expect(text).not.toContain("HIDDEN_SYNTHETIC_EXPORT_TASK"); expect(text).not.toContain(hidden); if (format === "csv") expect(text).toContain("'=Synthetic spreadsheet formula");
      const artifact = await db.complianceExport.findFirstOrThrow({ where: { projectId, format } }); expect(artifact.status).toBe("AVAILABLE"); expect(artifact.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(await db.auditLog.count({ where: { actorId: qaId, entityId: artifact.id, action: "DATA_EXPORTED" } })).toBe(1);
    }
    await page.reload(); await page.getByRole("button", { name: "移出", exact: true }).click(); await expect(memberRow).toHaveCount(0);
    const artifact = await db.complianceExport.findFirstOrThrow({ where: { projectId } });
    for (const url of [`/api/projects/${projectId}/exports`, `/api/exports/${artifact.id}/download`, `/api/tasks/${taskId}`]) expect((await qa.request.get(url)).status()).toBe(403);
    expect((await qa.request.get(`/projects/${projectId}/exports`)).status()).toBe(404);
  } finally { await qa.close(); }
});
