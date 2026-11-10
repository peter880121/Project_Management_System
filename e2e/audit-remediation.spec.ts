import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hashPassword } from "../src/modules/auth/password";
const db = new PrismaClient();
const run = randomUUID();
const accounts = ["QA", "PM", "MEMBER"].map((role) => ({
  id: randomUUID(),
  role,
  email: `audit-${run}-${role}@medpm.local`,
}));
let projectId: string, taskId: string, documentId: string, password: string;
test.beforeAll(async () => {
  if (
    !/^medpm_test_ia_/.test(
      new URL(process.env.DATABASE_URL!).pathname.slice(1),
    )
  )
    throw new Error("Isolated DB required");
  password = process.env.LOCAL_DEV_SEED_PASSWORD!;
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    for (const [i, role] of (["QA", "PM", "MEMBER"] as const).entries())
      await tx.user.create({
        data: {
          id: accounts[i].id,
          role,
          email: accounts[i].email,
          name: `Synthetic ${role}`,
          status: "ACTIVE",
          passwordHash,
        },
      });
    projectId = (
      await tx.project.create({
        data: {
          name: `Synthetic audit workflow ${run}`,
          ownerId: accounts[1].id,
          status: "ACTIVE",
        },
      })
    ).id;
    await tx.projectMember.createMany({
      data: [accounts[0].id, accounts[2].id].map((userId) => ({
        userId,
        projectId,
      })),
    });
    taskId = (
      await tx.task.create({
        data: { projectId, title: "Synthetic traceability gap" },
      })
    ).id;
    documentId = (
      await tx.document.create({
        data: {
          projectId,
          filename: "Synthetic remediation evidence.txt",
          minioKey: `synthetic/${run}`,
          mediaType: "text/plain",
          fileSize: 10,
          sha256: "a".repeat(64),
          storageStatus: "AVAILABLE",
          uploadedById: accounts[1].id,
        },
      })
    ).id;
    await tx.auditLog.create({
      data: {
        actorId: accounts[1].id,
        projectId,
        action: "TASK_STATUS_CHANGED",
        entityType: "Task",
        entityId: taskId,
        before: { status: "TODO" },
        after: { status: "IN_PROGRESS" },
        ip: "127.0.0.1",
        userAgent: "Synthetic E2E",
      },
    });
    await tx.auditLog.createMany({
      data: Array.from({ length: 51 }, () => ({
        actorId: accounts[1].id,
        projectId,
        action: "TASK_CREATED",
        entityType: "Task",
        entityId: taskId,
        after: { title: "Synthetic historical creation" },
        createdAt: new Date("2020-01-01T00:00:00Z"),
      })),
    });
  });
});
test.afterAll(async () => {
  try {
    await db.$transaction((tx) =>
      tx.session.deleteMany({
        where: { userId: { in: accounts.map((a) => a.id) } },
      }),
    );
  } finally {
    await db.$disconnect();
  }
});
test("readable evidence and QA–PM–member remediation with rule verification and tracked export", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  expect(
    (
      await page.request.post("/api/auth/login", {
        data: { email: accounts[0].email, password },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/audit");
  await page
    .getByLabel("选择审计项目", { exact: true })
    .selectOption(projectId);
  await page.getByRole("button", { name: "查询日志", exact: true }).click();
  const record = page.getByRole("article", {
    name: "更新任务状态",
    exact: true,
  });
  await expect(record).toBeVisible();
  await expect(record.getByText("待开始", { exact: true })).toBeVisible();
  await expect(record.getByText("进行中", { exact: true })).toBeVisible();
  await expect(record.locator("pre")).toBeHidden();
  await page.getByRole("button", { name: "加载更多记录", exact: true }).click();
  await expect(
    page
      .getByRole("tabpanel", { name: "操作记录", exact: true })
      .getByRole("article"),
  ).toHaveCount(52);
  mkdirSync("output/audit-remediation", { recursive: true });
  await page.screenshot({
    path: "output/audit-remediation/records.png",
    fullPage: true,
  });
  await record.getByRole("link", { name: "查看审计证据" }).click();
  await expect(
    page.getByRole("heading", { name: "审计记录详情", exact: true }),
  ).toBeVisible();
  const scan = await page.request.post("/api/audit/summary", {
    data: { projectId },
    timeout: 60000,
  });
  expect(scan.status()).toBe(200);
  const result = await scan.json();
  const issueId = result.issueRefs.find((r: { findingKey: string }) =>
    r.findingKey.includes(taskId),
  ).issueId;
  await page.goto(`/audit/issues/${issueId}`);
  await page.getByRole("button", { name: "确认问题", exact: true }).click();
  await page
    .getByLabel("整改处理说明")
    .fill("QA confirmed synthetic traceability gap");
  await page.getByRole("button", { name: "提交处理", exact: true }).click();
  await expect(page.getByText("待分派", { exact: true }).first()).toBeVisible();
  const pm = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const member = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    expect(
      (
        await pm.request.post("/api/auth/login", {
          data: { email: accounts[1].email, password },
        })
      ).status(),
    ).toBe(200);
    expect((await pm.request.get("/api/audit")).status()).toBe(403);
    const pmPage = await pm.newPage();
    await pmPage.goto(`/audit/issues/${issueId}`);
    await pmPage.getByRole("button", { name: "分派整改", exact: true }).click();
    await pmPage
      .getByLabel("整改负责人", { exact: true })
      .selectOption(accounts[2].id);
    await pmPage.getByLabel("截止日期（本地时区）").fill("2099-01-01T12:00");
    await pmPage
      .getByLabel("整改处理说明")
      .fill("Assign synthetic correction to project member");
    await pmPage.getByRole("button", { name: "提交处理", exact: true }).click();
    await expect(
      pmPage.getByText("整改中", { exact: true }).first(),
    ).toBeVisible();
    expect(
      (
        await member.request.post("/api/auth/login", {
          data: { email: accounts[2].email, password },
        })
      ).status(),
    ).toBe(200);
    const memberPage = await member.newPage();
    await memberPage.goto(`/audit/issues/${issueId}`);
    await memberPage
      .getByRole("button", { name: "提交整改", exact: true })
      .click();
    await memberPage.getByLabel("Synthetic remediation evidence.txt").check();
    await memberPage
      .getByLabel("整改处理说明")
      .fill("Synthetic fix and supporting evidence submitted");
    await memberPage
      .getByRole("button", { name: "提交处理", exact: true })
      .click();
    await expect(
      memberPage.getByText("待验证", { exact: true }).first(),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "验证并关闭", exact: true }).click();
    await page
      .getByLabel("整改处理说明")
      .fill("Verify current requirements and attached evidence");
    await page.getByRole("button", { name: "提交处理", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "当前规则复查仍发现该问题",
    );
    await db.$transaction(async (tx) => {
      const req = await tx.requirement.create({
        data: {
          projectId,
          title: "Synthetic linked requirement",
          content: "Synthetic correction",
        },
      });
      await tx.task.update({
        where: { id: taskId },
        data: { requirementId: req.id, reviewedRequirementVersion: 1 },
      });
    });
    await page.getByRole("button", { name: "提交处理", exact: true }).click();
    await expect(
      page.getByText("已关闭", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/规则复查通过/)).toBeVisible();
    await page.screenshot({
      path: "output/audit-remediation/closed-issue.png",
      fullPage: true,
    });
    await page.goto(`/audit/issues?projectId=${projectId}`);
    await expect(
      page.getByRole("link", { name: /任务缺少关联需求/ }),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出整改报告", exact: true })
      .click();
    await (await download).saveAs("output/audit-remediation/report.html");
    expect(
      await db.auditLog.count({
        where: { projectId, action: "AUDIT_REPORT_EXPORTED" },
      }),
    ).toBe(1);
    expect(
      (
        await db.auditIssueEvent.findMany({
          where: { issueId },
          orderBy: { createdAt: "asc" },
        })
      ).map((e) => e.action),
    ).toEqual(["CONFIRM", "ASSIGN", "SUBMIT", "CLOSE"]);
  } finally {
    await pm.close();
    await member.close();
  }
  expect(documentId).toBeTruthy();
});
