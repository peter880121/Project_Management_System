import { PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
const db = new PrismaClient();
const pm = "00000000-0000-4000-8000-000000000002";
let author: string, project: string;
test.use({ trace: "off" });
test.beforeEach(async ({ context, baseURL }) => {
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: `weekly-${crypto.randomUUID()}@medpm.local`,
        name: "合成周报员工",
        role: "MEMBER",
        status: "ACTIVE",
      },
    });
    author = user.id;
    project = (
      await tx.project.create({
        data: { name: "合成周报项目", ownerId: pm, status: "ACTIVE" },
      })
    ).id;
    await tx.projectMember.create({
      data: { projectId: project, userId: author },
    });
  });
  await context.addCookies([
    {
      name: "medpm_session",
      value: createSessionToken(author, Date.now() + 3600000),
      url: baseURL!,
      httpOnly: true,
    },
  ]);
});
test.afterAll(() => db.$disconnect());
test("writes, autosaves, submits and revises a weekly report", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/weekly-reports");
  await expect(
    page.getByRole("heading", { name: "个人周报", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "写周报", exact: true }).click();
  await page.getByLabel("添加项目分区", { exact: true }).selectOption(project);
  const saved = page.waitForResponse(
    (r) =>
      r.url().includes("/api/weekly-reports/") &&
      r.request().method() === "PATCH" &&
      r.ok(),
  );
  await page
    .getByLabel("合成周报项目进展摘要", { exact: true })
    .fill("已确认本周交付范围，下周继续验证。仅使用合成数据。");
  await saved;
  await expect(
    page.getByRole("button", { name: "确认提交", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "周报已提交" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("合成周报项目进展摘要", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "发起修订", exact: true }).click();
  await page
    .getByLabel("修订说明", { exact: true })
    .fill("补充本周客户沟通结果及下周安排");
  await page.getByRole("button", { name: "确认修订", exact: true }).click();
  await expect(
    page.getByLabel("合成周报项目进展摘要", { exact: true }),
  ).toBeEnabled();
  expect(
    await db.weeklyReportRevision.count({
      where: { report: { authorId: author } },
    }),
  ).toBe(1);
});
test("collects candidates explicitly and does not turn task effort into weekly hours", async ({
  page,
}) => {
  test.setTimeout(60000);
  await db.$transaction((tx) =>
    tx.task.create({
      data: {
        projectId: project,
        title: "合成待办验证任务",
        assigneeId: author,
        status: "IN_PROGRESS",
        estimateHours: 40,
      },
    }),
  );
  await page.goto("/weekly-reports");
  await page.getByRole("button", { name: "写周报", exact: true }).click();
  await page.getByRole("button", { name: "汇总我的工作", exact: true }).click();
  await expect(
    page.getByText("任务：合成待办验证任务（IN_PROGRESS）", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("申报工时", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "采纳", exact: true }).click();
  await expect(page.getByLabel("申报工时", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("工作内容", { exact: true })).toHaveValue(
    "任务：合成待办验证任务（IN_PROGRESS）",
  );
});
test("PM reviews only their own project section and cannot see private sections", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(60000);
  const created = await page.request.post("/api/weekly-reports", {
    data: {
      week: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
    },
  });
  expect(created.ok()).toBe(true);
  const row = await created.json();
  const saved = await page.request.patch(`/api/weekly-reports/${row.id}`, {
    data: {
      expectedVersion: 1,
      sections: [
        {
          id: crypto.randomUUID(),
          projectId: project,
          summary: "该项目的合成交付进展",
          items: [],
        },
        {
          id: crypto.randomUUID(),
          projectId: null,
          summary: "不应向项目PM展示的个人事项",
          items: [],
        },
      ],
    },
  });
  expect(saved.ok()).toBe(true);
  const result = await saved.json();
  const submitted = await page.request.post(
    `/api/weekly-reports/${row.id}/submit`,
    { data: { expectedVersion: result.rowVersion } },
  );
  expect(submitted.ok()).toBe(true);
  await context.addCookies([
    {
      name: "medpm_session",
      value: createSessionToken(pm, Date.now() + 3600000),
      url: baseURL!,
      httpOnly: true,
    },
  ]);
  await page.goto("/weekly-reports");
  await page.getByRole("button", { name: "待我阅知", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "合成周报员工" }).click();
  await expect(
    page.getByLabel("合成周报项目进展摘要", { exact: true }),
  ).toHaveValue("该项目的合成交付进展");
  await expect(page.getByText("不应向项目PM展示的个人事项")).toHaveCount(0);
  await page.getByRole("button", { name: "已阅", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已阅知该项目分区" }),
  ).toBeVisible();
});
