import { PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
import { hkToday } from "../src/modules/weekly-reports/policy";
import { mkdir } from "node:fs/promises";
import { changeProjectLifecycle } from "../src/modules/projects/lifecycle";
import { recordAudit } from "../src/modules/audit/service";
import { prisma as serviceDb } from "../src/lib/prisma";
const db = new PrismaClient();
const pm = "00000000-0000-4000-8000-000000000002",
  member = "00000000-0000-4000-8000-000000000003",
  qa = "00000000-0000-4000-8000-000000000004";
let project: string, frozenProject: string;
test.use({ trace: "off" });
test.beforeAll(async () => {
  const day = (offset: number) =>
    new Date(new Date(`${hkToday()}T00:00:00Z`).getTime() + offset * 86400000);
  await db.$transaction(async (tx) => {
    project = (
      await tx.project.create({
        data: { name: "合成决策验收项目", ownerId: pm, status: "ACTIVE" },
      })
    ).id;
    await tx.projectMember.createMany({
      data: [
        { projectId: project, userId: member },
        { projectId: project, userId: qa },
      ],
    });
    const tracked = await tx.task.create({
      data: {
        projectId: project,
        assigneeId: member,
        title: "合成可追溯开发任务",
        status: "IN_PROGRESS",
        estimateHours: 8,
        dueDate: day(-1),
      },
    });
    await recordAudit(tx, {
      actorId: member,
      projectId: project,
      action: "TASK_CREATED",
      entityType: "Task",
      entityId: tracked.id,
      after: { syntheticFixture: true },
      ip: "127.0.0.1",
      userAgent: "Decision center synthetic test",
    });
    for (const [title, status, offset] of [
      ["较早创建的逾期任务", "TODO", -10],
      ["当前进行中任务", "IN_PROGRESS", 2],
      ["未来待办任务", "TODO", 1],
      ["已完成的历史任务", "DONE", -20],
    ] as const)
      await tx.task.create({
        data: {
          projectId: project,
          assigneeId: member,
          title,
          status,
          dueDate: day(offset),
          estimateHours: 4,
          createdAt:
            title === "较早创建的逾期任务"
              ? new Date("2026-04-01T00:00:00Z")
              : new Date(),
          ...(status === "DONE"
            ? { completedAt: day(-20), actualHours: 4 }
            : {}),
        },
      });
    const frozen = await tx.project.create({
      data: { name: "已暂停的合成人员项目", ownerId: pm, status: "ACTIVE" },
    });
    frozenProject = frozen.id;
    await tx.projectMember.create({
      data: { projectId: frozen.id, userId: member },
    });
    await tx.task.create({
      data: {
        projectId: frozen.id,
        assigneeId: member,
        title: "冻结项目的历史逾期任务",
        status: "IN_PROGRESS",
        dueDate: day(-30),
      },
    });
    await tx.requirement.create({
      data: {
        projectId: project,
        title: "合成需求验证",
        content: "Synthetic",
        managed: true,
        ownerId: member,
        workflowState: "IMPLEMENTING",
        dueDate: new Date("2026-10-31T00:00:00.000Z"),
      },
    });
  });
  await changeProjectLifecycle(
    frozenProject,
    "pause",
    {
      expectedRowVersion: 1,
      requestKey: crypto.randomUUID(),
      reason: "合成测试暂停项目，核对冻结积压与活跃工作分离",
    },
    { actorId: pm },
  );
});
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: "medpm_session",
      value: createSessionToken(pm, Date.now() + 3600000),
      url: baseURL!,
      httpOnly: true,
    },
  ]);
});
test.afterAll(async () => {
  await db.$disconnect();
  await serviceDb.$disconnect();
});
test("drills from a person into their responsible projects, tasks and requirements", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto(`/dashboard?tab=people&projectId=${project}`);
  await expect(
    page.getByRole("heading", { name: "人员决策视图" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "业务明细", exact: true }),
  ).toBeVisible();
  const user = await db.user.findUniqueOrThrow({ where: { id: member } });
  await page.getByRole("button").filter({ hasText: user.email }).click();
  await expect(
    page.getByRole("heading", { name: user.name, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/tab=tasks/);
  await expect(
    page.getByRole("heading", { name: "当前待跟进任务", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "当前待跟进", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "任务明细", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "合成可追溯开发任务", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("人员职责类型")).toHaveValue("RESPONSIBLE");
  await page.getByRole("button", { name: "需求明细", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "合成需求验证", exact: true }),
  ).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/dashboard/insights") && response.ok(),
    ),
    page.reload(),
  ]);
  await expect(
    page.getByRole("heading", { name: user.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "合成需求验证", exact: true }),
  ).toBeVisible();
});

test("prioritizes current work, preserves URL filters and collapses historical handling", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto(
    `/dashboard?tab=tasks&personId=${member}&projectId=${project}&dateField=CREATED&from=${hkToday()}&to=${hkToday()}`,
  );
  const summary = page.getByRole("region", { name: "人员当前任务概况" });
  // The card section has its own accessible name, and the active table is the first business content.
  await expect(
    page.getByRole("heading", { name: "当前待跟进任务", exact: true }),
  ).toBeVisible();
  await expect(summary).toContainText("进行中任务");
  const taskRows = page.locator("table tbody tr");
  await expect(taskRows).toHaveCount(4);
  await expect(taskRows.nth(0)).toContainText("较早创建的逾期任务");
  await expect(taskRows.nth(1)).toContainText("合成可追溯开发任务");
  await expect(taskRows.nth(1)).toContainText("进行中");
  await expect(taskRows.nth(1)).toContainText("已逾期");
  await expect(taskRows.nth(2)).toContainText("当前进行中任务");
  await expect(
    page.getByRole("link", { name: "已完成的历史任务", exact: true }),
  ).toHaveCount(0);
  const history = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "历史办理记录" }) });
  await expect(history).not.toHaveAttribute("open");
  await history.locator("summary").click();
  await expect(history).toHaveAttribute("open", "");
  await expect(history).toContainText("创建任务");
  await expect(history).not.toContainText("TASK_CREATED");
  await page.getByRole("button", { name: "全部任务", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "已完成的历史任务", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "当前待跟进", exact: true }).click();
  await page.getByLabel("任务排序", { exact: true }).selectOption("NEWEST");
  await expect(page).toHaveURL(/taskSort=NEWEST/);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/dashboard/insights") && response.ok(),
    ),
    page.reload(),
  ]);
  await expect(page.getByLabel("任务排序", { exact: true })).toHaveValue(
    "NEWEST",
  );
  await expect(
    page.getByRole("button", { name: "当前待跟进", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("table tbody tr")).toHaveCount(4);
  await page.getByLabel("任务排序", { exact: true }).selectOption("FOLLOW_UP");
  await expect(page).toHaveURL(/taskSort=FOLLOW_UP/);
  const firstTask = page.getByRole("link", {
    name: "较早创建的逾期任务",
    exact: true,
  });
  await firstTask.click();
  await expect(page).toHaveURL(/\/tasks\//);
  await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
  await expect(page.getByLabel("任务排序", { exact: true })).toHaveValue(
    "FOLLOW_UP",
  );
  await page.getByLabel("统计项目").selectOption(frozenProject);
  await expect(page).toHaveURL(new RegExp(`projectId=${frozenProject}`));
  await page.getByRole("button", { name: "冻结积压", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "冻结项目积压任务", exact: true }),
  ).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(1);
  await expect(page.locator("table tbody tr")).toContainText(
    "冻结项目的历史逾期任务",
  );
  await expect(page.locator("table tbody tr")).not.toContainText("已逾期");
  await page.getByLabel("统计项目").selectOption(project);
  await expect(page).toHaveURL(new RegExp(`projectId=${project}`));
  await page.getByRole("button", { name: "当前待跟进", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "当前待跟进任务", exact: true }),
  ).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(4);
  await mkdir("test-results/decision-center-priority", { recursive: true });
  await page.screenshot({
    path: "test-results/decision-center-priority/person-current-tasks.png",
    fullPage: true,
  });
});
test("filters, handles an aggregation failure and links weekly reporting", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto(`/dashboard?tab=tasks&projectId=${project}`);
  await expect(
    page.getByRole("link", { name: "合成可追溯开发任务" }),
  ).toBeVisible();
  await page.getByLabel("搜索统计明细").fill("不存在的合成任务");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(
    page.getByText("当前筛选下暂无数据。", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/dashboard/insights?*", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Synthetic aggregation unavailable" },
    }),
  );
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Synthetic aggregation unavailable" }),
  ).toContainText("Synthetic aggregation unavailable");
  await page.unroute("**/api/dashboard/insights?*");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(
    page.getByText("当前筛选下暂无数据。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "周报", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "周报与交付跟进" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "进入个人周报与阅知台账 →" }),
  ).toBeVisible();
});
test("rejects QA and member API access and intersects a forged project filter", async ({
  page,
  context,
  baseURL,
}) => {
  for (const userId of [qa, member]) {
    await context.addCookies([
      {
        name: "medpm_session",
        value: createSessionToken(userId, Date.now() + 3600000),
        url: baseURL!,
        httpOnly: true,
      },
    ]);
    expect(
      (
        await page.request.get("/api/dashboard/insights?dimension=people")
      ).status(),
    ).toBe(403);
  }
  await context.addCookies([
    {
      name: "medpm_session",
      value: createSessionToken(pm, Date.now() + 3600000),
      url: baseURL!,
      httpOnly: true,
    },
  ]);
  const foreign = await db.$transaction((tx) =>
    tx.project.create({
      data: {
        name: "Synthetic foreign project",
        ownerId: "00000000-0000-4000-8000-000000000001",
        status: "ACTIVE",
      },
    }),
  );
  const response = await page.request.get(
    `/api/dashboard/insights?dimension=tasks&projectId=${foreign.id}`,
  );
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.rows).toEqual([]);
  expect(data.total).toBe(0);
});
