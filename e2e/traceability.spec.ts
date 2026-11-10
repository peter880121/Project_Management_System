import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";

const db = new PrismaClient();
const runId = randomUUID();
const emails = [`trace-test-${runId}-pm@medpm.local`, `trace-test-${runId}-qa@medpm.local`];
let password: string;
test.beforeAll(async () => {
  password = process.env.LOCAL_DEV_SEED_PASSWORD || "";
  if (!password) throw new Error("Set LOCAL_DEV_SEED_PASSWORD before traceability E2E");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    for (const [index, role] of (["PM", "QA"] as const).entries()) {
      await tx.user.create({ data: { email: emails[index], name: "Synthetic Traceability", role, status: "ACTIVE", passwordHash } });
    }
  });
});
test.afterAll(async () => {
  try { await db.$transaction((tx) => tx.session.deleteMany({ where: { user: { email: { in: emails } } } })); }
  finally { await db.$disconnect(); }
});

test("PM creates project and traceability; QA records a test result with audit provenance", async ({ page }) => {
  test.setTimeout(60_000);
  expect((await page.request.post("/api/auth/login", { data: { email: emails[0], password } })).status()).toBe(200);
  await page.goto("/projects");
  await page.getByRole("link", { name: "创建项目", exact: true }).click();
  const projectName = `Synthetic traceability ${runId}`;
  await page.getByLabel("项目名称", { exact: true }).fill(projectName);
  await page.getByLabel("项目描述", { exact: true }).fill("Synthetic release acceptance");
  const projectCreated = page.waitForResponse(response => new URL(response.url()).pathname === "/api/projects" && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  expect((await projectCreated).status()).toBe(201);
  await page.waitForURL(url => /^\/projects\/[0-9a-f-]{36}\/members$/.test(url.pathname));
  const projectId = page.url().split("/").at(-2)!;
  const qa = await db.user.findUniqueOrThrow({ where: { email: emails[1] } });
  expect((await page.request.put(`/api/projects/${projectId}/members`, { data: { userId: qa.id, active: true, expectedVersion: 0 } })).status()).toBe(200);
  await page.goto(`/projects/${projectId}/board`);
  await page.goto(`/projects/${projectId}/requirements`);
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel("需求标题", { exact: true }).fill("Synthetic acceptance requirement");
  await create.getByLabel("需求说明", { exact: true }).fill("Verify synthetic release approval");
  await create.getByLabel("验收标准", { exact: true }).fill("Verify all synthetic acceptance criteria");
  await create.getByLabel("预计完成日期", { exact: true }).fill("2026-12-31");
  const pmActor = await db.user.findUniqueOrThrow({ where: { email: emails[0] } });
  await create.getByLabel("需求负责人", { exact: true }).selectOption(pmActor.id);
  await create.getByRole("button", { name: "确认并保存", exact: true }).click();
  const detail = page.getByRole("region", { name: "需求详情", exact: true });
  await expect(detail.getByRole("heading", { name: "Synthetic acceptance requirement", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "编辑需求与图片", exact: true }).click();
  const editRequirement = page.getByRole("dialog");
  await editRequirement.getByLabel("需求说明", { exact: true }).fill("Updated synthetic approval criteria");
  await editRequirement.getByRole("button", { name: "确认并保存", exact: true }).click();
  await expect(detail).toContainText("Updated synthetic approval criteria");
  await page.goto(`/projects/${projectId}/traceability`);
  const trace = (await (await page.request.get(`/api/projects/${projectId}/traceability`)).json()).data;
  const requirementId = trace.requirements[0].id;
  const createdTask = await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title: "Synthetic trace task", phase: "项目启动", estimateHours: 4, dueDate: "2026-12-31" } });
  expect(createdTask.status()).toBe(201);
  const taskId = (await createdTask.json()).data.id;
  await page.reload();
  const linkForm = page.locator("form").filter({ has: page.getByRole("link", { name: "Synthetic trace task", exact: true }) });
  await linkForm.getByLabel("关联需求", { exact: true }).selectOption(requirementId);
  await linkForm.getByRole("button", { name: "保存关联", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect((await (await page.request.get(`/api/tasks/${taskId}`)).json()).data.requirement.id).toBe(requirementId);

  expect((await page.request.post("/api/auth/logout")).status()).toBe(200);
  expect((await page.request.post("/api/auth/login", { data: { email: emails[1], password } })).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("button", { name: "保存需求", exact: true })).toHaveCount(0);
  const testCreate = page.locator("form").filter({ has: page.getByRole("heading", { name: "新增测试用例", exact: true }) });
  await testCreate.getByLabel("测试用例标题", { exact: true }).fill("Synthetic acceptance test");
  await testCreate.getByRole("button", { name: "创建测试用例", exact: true }).click();
  const edit = page.locator("form").filter({ has: page.getByRole("button", { name: "保存测试用例", exact: true }) });
  await expect(edit).toBeVisible();
  await edit.getByLabel("测试结果", { exact: true }).selectOption("PASSED");
  await edit.getByRole("button", { name: "保存测试用例", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByText("Synthetic acceptance test", { exact: true })).toBeVisible();
  await expect(page.getByText("PASSED", { exact: true })).toBeVisible();
  const audits = (await (await page.request.get(`/api/audit?projectId=${projectId}`)).json()).data;
  expect(audits.map((entry: { action: string }) => entry.action)).toEqual(expect.arrayContaining(["PROJECT_CREATED", "REQUIREMENT_CREATED", "REQUIREMENT_UPDATED", "TASK_REQUIREMENT_CHANGED", "TEST_CASE_CREATED", "TEST_CASE_UPDATED"]));
  expect(audits.every((entry: { actorId: string; entityId: string; userAgent: string | null }) => entry.actorId && entry.entityId && entry.userAgent)).toBe(true);
});
