import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  failAudit: false,
}));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.db;
  },
}));
import {
  captureDecisionSnapshots,
  decisionData,
} from "@/modules/dashboard/decision-service";
import { recordAudit } from "@/modules/audit/service";
import { changeProjectLifecycle } from "@/modules/projects/lifecycle";
import { hkToday } from "@/modules/weekly-reports/policy";
import { decisionQuerySchema } from "@/modules/dashboard/decision-schema";
import { taskDecision } from "@/modules/dashboard/decision-repositories";
const db = new PrismaClient();
state.db = db.$extends({
  query: {
    auditLog: {
      create: async ({ args, query }) => {
        if (state.failAudit && args.data.action === "DATA_EXPORTED")
          throw new Error("Synthetic export audit outage");
        return query(args);
      },
    },
  },
});
let pm: string,
  other: string,
  member: string,
  qa: string,
  admin: string,
  pmo: string,
  project: string,
  hidden: string,
  paused: string,
  task: string;
const today = () => new Date(`${hkToday()}T00:00:00.000Z`);
describe.sequential("decision center scoped real MySQL aggregation", () => {
  beforeAll(async () => {
    if (
      !/^medpm_test_ia_/.test(
        new URL(process.env.DATABASE_URL!).pathname.slice(1),
      )
    )
      throw new Error("Isolated database required");
    for (let i = 0; i < 2; i++)
      execFileSync(
        process.execPath,
        [
          "node_modules/prisma/build/index.js",
          "db",
          "execute",
          "--file",
          "prisma/migrations/20261031000000_decision_center/migration.sql",
          "--schema",
          "prisma/schema.prisma",
        ],
        { env: process.env, stdio: "pipe", windowsHide: true },
      );
    [pm, other, member, qa, admin, pmo] = await db.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const role of ["PM", "PM", "MEMBER", "QA", "ADMIN", "PMO"] as const)
        ids.push(
          (
            await tx.user.create({
              data: {
                name: `Synthetic ${role}`,
                email: `${randomUUID()}@medpm.local`,
                role,
                status: "ACTIVE",
              },
            })
          ).id,
        );
      return ids;
    });
    const yesterday = new Date(today().getTime() - 86400000);
    await db.$transaction(async (tx) => {
      project = (
        await tx.project.create({
          data: { name: "Synthetic visible A", ownerId: pm, status: "ACTIVE" },
        })
      ).id;
      hidden = (
        await tx.project.create({
          data: {
            name: "Synthetic hidden B",
            ownerId: other,
            status: "ACTIVE",
          },
        })
      ).id;
      paused = (
        await tx.project.create({
          data: { name: "Synthetic paused", ownerId: pm, status: "ACTIVE" },
        })
      ).id;
      await tx.projectMember.createMany({
        data: [project, hidden, paused].flatMap((projectId) => [
          { projectId, userId: member },
          { projectId, userId: qa },
        ]),
      });
      task = (
        await tx.task.create({
          data: {
            projectId: project,
            assigneeId: member,
            title: "Synthetic implementation",
            status: "IN_PROGRESS",
            dueDate: yesterday,
            estimateHours: 8,
          },
        })
      ).id;
      await tx.task.create({
        data: {
          projectId: project,
          assigneeId: member,
          title: "Synthetic done",
          status: "DONE",
          dueDate: today(),
          completedAt: today(),
          estimateHours: 2,
          actualHours: 3,
        },
      });
      const canceled = await tx.task.create({
        data: {
          projectId: project,
          assigneeId: member,
          title: "Synthetic canceled late",
          status: "TODO",
          dueDate: yesterday,
        },
      });
      await tx.task.update({
        where: { id: canceled.id },
        data: {
          status: "CANCELLED",
          cancelReason: "Synthetic documented scope removal",
          cancelledAt: new Date(),
          cancelledById: pm,
        },
      });
      await tx.task.create({
        data: {
          projectId: hidden,
          assigneeId: member,
          title: "Hidden secret task",
          status: "TODO",
          dueDate: yesterday,
        },
      });
      await tx.task.create({
        data: {
          projectId: paused,
          assigneeId: member,
          title: "Frozen backlog",
          status: "TODO",
          dueDate: yesterday,
        },
      });
      for (const title of [
        "Synthetic primary requirement",
        "Synthetic linked requirement",
      ]) {
        const r = await tx.requirement.create({
          data: {
            projectId: project,
            title,
            content: "Synthetic content",
            managed: true,
            ownerId: member,
            workflowState: "IMPLEMENTING",
            status: "APPROVED",
            approvedVersion: 1,
            dueDate: yesterday,
          },
        });
        await tx.requirementTaskLink.create({
          data: {
            projectId: project,
            requirementId: r.id,
            taskId: task,
            createdById: pm,
          },
        });
      }
      await tx.requirement.create({
        data: {
          projectId: hidden,
          title: "Hidden secret requirement",
          content: "Synthetic",
          managed: true,
          ownerId: member,
        },
      });
    });
    await changeProjectLifecycle(
      paused,
      "pause",
      {
        expectedRowVersion: 1,
        requestKey: randomUUID(),
        reason: "Synthetic pause for scope clarification",
      },
      { actorId: pm },
    );
  });
  afterAll(() => db.$disconnect());
  it("aggregates projects, tasks and requirements without multiplying a shared task", async () => {
    const people = await decisionData(pm, {
      dimension: "people",
      projectId: project,
      personId: member,
    });
    expect(people.rows[0].openTasks).toBe(1);
    expect(people.rows[0].openRequirements).toBe(2);
    expect(people.rows[0].openEstimatedHours).toBe(8);
    const tasks = await decisionData(pm, {
      dimension: "tasks",
      projectId: project,
    });
    expect(tasks.total).toBe(2);
    expect(tasks.groups.reduce((n, g) => n + g.count, 0)).toBe(2);
    const req = await decisionData(pm, {
      dimension: "requirements",
      projectId: project,
    });
    expect(req.rows.map((r) => r.linkedTasks)).toEqual([1, 1]);
    expect(req.metrics.find((m) => m.label === "无有效任务覆盖")?.value).toBe(
      0,
    );
    const p = await decisionData(pm, {
      dimension: "projects",
      projectId: project,
    });
    expect(p.rows[0].taskTotal).toBe(2);
    expect(p.rows[0].taskDone).toBe(1);
  });
  it("returns empty records for a forged project scope in every dimension", async () => {
    for (const dimension of ["projects", "tasks", "requirements", "people"]) {
      const result = await decisionData(pm, {
        dimension,
        projectId: hidden,
        personId: member,
      });
      expect(result.total).toBe(0);
      expect(result.rows).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("Hidden secret");
      expect(result.person).toBe(null);
    }
  });
  it("separates frozen backlog and cancelled tasks from active resource load", async () => {
    const result = await decisionData(pm, {
      dimension: "people",
      personId: member,
    });
    expect(result.rows[0].openTasks).toBe(1);
    expect(result.rows[0].frozenTasks).toBe(1);
    expect(result.rows[0].overdueTasks).toBe(1);
    const overdue = await decisionData(pm, {
      dimension: "tasks",
      personId: member,
      exception: "OVERDUE",
    });
    expect(overdue.total).toBe(1);
    const canceled = await decisionData(pm, {
      dimension: "tasks",
      projectId: project,
      status: "CANCELLED",
    });
    expect(canceled.total).toBe(1);
  });
  it("calculates plan/actual variance only from valid completed pairs", async () => {
    const result = await decisionData(pm, {
      dimension: "tasks",
      projectId: project,
    });
    expect(
      result.metrics.find((m) => m.label === "实际－计划工时")?.value,
    ).toBe(1);
    expect(result.metrics.find((m) => m.label === "按期完成率")?.value).toBe(
      100,
    );
  });
  it("distinguishes project participation, current responsibility and real handling", async () => {
    const owned = await decisionData(pm, {
      dimension: "projects",
      personId: member,
    });
    expect(owned.total).toBe(0);
    const participating = await decisionData(pm, {
      dimension: "projects",
      personId: member,
      relation: "PARTICIPATING",
    });
    expect(participating.total).toBe(2);
    const before = await decisionData(pm, {
      dimension: "tasks",
      personId: qa,
      relation: "HANDLED",
    });
    expect(before.total).toBe(0);
    await db.$transaction((tx) =>
      recordAudit(tx, {
        actorId: qa,
        projectId: project,
        action: "TASK_SIGNED_AND_COMPLETED",
        entityType: "Task",
        entityId: task,
        after: { syntheticTest: true },
      }),
    );
    const after = await decisionData(pm, {
      dimension: "tasks",
      personId: qa,
      relation: "HANDLED",
    });
    expect(after.total).toBe(1);
    expect(after.person?.role).toBe("QA");
    expect(after.events.some((e) => e.roleAtEvent === "QA")).toBe(true);
    await db.$transaction((tx) =>
      tx.user.update({ where: { id: qa }, data: { role: "MEMBER" } }),
    );
    const changed = await decisionData(pm, {
      dimension: "tasks",
      personId: qa,
      relation: "HANDLED",
    });
    expect(changed.person?.role).toBe("MEMBER");
    expect(changed.events.some((e) => e.roleAtEvent === "QA")).toBe(true);
  });
  it("does not grant QA or MEMBER dashboard access", async () => {
    await expect(
      decisionData(member, { dimension: "projects" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      decisionData(qa, { dimension: "people" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await decisionData(pmo, { dimension: "projects", projectId: hidden }))
        .total,
    ).toBe(1);
  });
  it("takes a prospective immutable daily snapshot exactly once", async () => {
    const first = await captureDecisionSnapshots(admin);
    const second = await captureDecisionSnapshots(admin);
    expect(first.inserted).toBeGreaterThan(0);
    expect(second.inserted).toBe(0);
    const result = await decisionData(pm, {
      dimension: "projects",
      projectId: project,
    });
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].taskTotal).toBe(2);
    await expect(
      db.$executeRaw`UPDATE DecisionSnapshot SET taskTotal=999 WHERE projectId=${project}`,
    ).rejects.toThrow("ER_DECISION_SNAPSHOT_IMMUTABLE");
    await expect(captureDecisionSnapshots(pm)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("paginates within scope and audits exports before returning content", async () => {
    const empty = await decisionData(pm, {
      dimension: "tasks",
      projectId: project,
      page: 100,
    });
    expect(empty.rows).toEqual([]);
    expect(empty.total).toBe(2);
    await decisionData(
      pm,
      { dimension: "tasks", projectId: project },
      { ip: "127.0.0.1" },
      true,
    );
    expect(
      await db.auditLog.count({
        where: {
          actorId: pm,
          action: "DATA_EXPORTED",
          entityType: "DecisionCenter",
        },
      }),
    ).toBe(1);
    state.failAudit = true;
    try {
      await expect(
        decisionData(pm, { dimension: "tasks" }, {}, true),
      ).rejects.toThrow("Synthetic export audit outage");
    } finally {
      state.failAudit = false;
    }
  });
  it("places records exactly on Hong Kong month boundaries in the correct period", async () => {
    await db.$transaction(async (tx) => {
      for (const [index, instant] of [
        "2026-09-30T15:59:59.999Z",
        "2026-09-30T16:00:00.000Z",
        "2026-10-31T15:59:59.999Z",
        "2026-10-31T16:00:00.000Z",
      ].entries()) {
        await tx.task.create({
          data: {
            projectId: project,
            title: `Boundary synthetic ${index}`,
            status: "TODO",
            createdAt: new Date(instant),
          },
        });
      }
    });
    const october = await decisionData(pm, {
      dimension: "tasks",
      projectId: project,
      dateField: "CREATED",
      from: "2026-10-01",
      to: "2026-10-31",
      q: "Boundary synthetic",
    });
    expect(october.total).toBe(2);
    expect(october.rows.map((row) => row.title).sort()).toEqual([
      "Boundary synthetic 1",
      "Boundary synthetic 2",
    ]);
    const november = await decisionData(pm, {
      dimension: "tasks",
      projectId: project,
      dateField: "CREATED",
      from: "2026-11-01",
      to: "2026-11-30",
      q: "Boundary synthetic",
    });
    expect(november.total).toBe(1);
    expect(november.rows[0].title).toBe("Boundary synthetic 3");
  });
  it("prioritizes the complete current backlog before pagination, independently of creation dates", async () => {
    const day = (offset: number) =>
      new Date(today().getTime() + offset * 86400000);
    const ids = await db.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: { name: "人员优先任务（合成）", ownerId: pm, status: "ACTIVE" },
      });
      const frozen = await tx.project.create({
        data: { name: "人员冻结积压（合成）", ownerId: pm, status: "ACTIVE" },
      });
      await tx.projectMember.createMany({
        data: [p.id, frozen.id].map((projectId) => ({
          projectId,
          userId: member,
        })),
      });
      const overdue: string[] = [];
      for (let i = 0; i < 21; i++)
        overdue.push(
          (
            await tx.task.create({
              data: {
                projectId: p.id,
                assigneeId: member,
                title: `旧建逾期任务${i}`,
                status: ["TODO", "IN_PROGRESS", "BLOCKED"][i % 3] as
                  "TODO" | "IN_PROGRESS" | "BLOCKED",
                dueDate: day(-25 + i),
                createdAt: new Date("2026-04-01T00:00:00Z"),
              },
            })
          ).id,
        );
      const extra = [];
      for (const [title, status, offset] of [
        ["今日进行中", "IN_PROGRESS", 0],
        ["未来进行中", "IN_PROGRESS", 2],
        ["未排期进行中", "IN_PROGRESS", null],
        ["未逾期受阻", "BLOCKED", 3],
        ["未来待办", "TODO", 1],
        ["未排期待办", "TODO", null],
        ["已完成历史", "DONE", -30],
      ] as const)
        extra.push(
          (
            await tx.task.create({
              data: {
                projectId: p.id,
                assigneeId: member,
                title,
                status,
                dueDate: offset === null ? null : day(offset),
                ...(status === "DONE"
                  ? { completedAt: day(-30), actualHours: 1 }
                  : {}),
              },
            })
          ).id,
        );
      const canceled = await tx.task.create({
        data: {
          projectId: p.id,
          assigneeId: member,
          title: "已取消历史",
          status: "TODO",
          dueDate: day(-100),
        },
      });
      await tx.task.update({
        where: { id: canceled.id },
        data: {
          status: "CANCELLED",
          cancelReason: "本次模拟范围已正式撤销，保留历史",
          cancelledById: pm,
          cancelledAt: new Date(),
        },
      });
      const backlog = await tx.task.create({
        data: {
          projectId: frozen.id,
          assigneeId: member,
          title: "暂停项目的旧任务",
          status: "IN_PROGRESS",
          dueDate: day(-100),
        },
      });
      await tx.task.create({
        data: {
          projectId: p.id,
          assigneeId: qa,
          title: "别人负责的任务",
          status: "IN_PROGRESS",
          dueDate: day(-100),
        },
      });
      return {
        project: p.id,
        frozen: frozen.id,
        overdue,
        extra,
        canceled: canceled.id,
        backlog: backlog.id,
      };
    });
    await changeProjectLifecycle(
      ids.frozen,
      "pause",
      {
        expectedRowVersion: 1,
        requestKey: randomUUID(),
        reason: "等待范围澄清，冻结积压不能计入当前任务",
      },
      { actorId: pm },
    );
    const query = {
      dimension: "tasks",
      personId: member,
      projectId: ids.project,
      dateField: "CREATED",
      from: hkToday(),
      to: hkToday(),
    };
    const first = await decisionData(pm, query);
    expect(first.total).toBe(27);
    expect(first.rows.map((r) => r.id)).toEqual(ids.overdue.slice(0, 20));
    expect(first.personTasks).toMatchObject({
      current: 27,
      inProgress: 10,
      overdue: 21,
      blocked: 8,
      frozen: 0,
    });
    const second = await decisionData(pm, { ...query, page: 2 });
    expect(second.rows.map((r) => r.id)).toEqual([
      ids.overdue[20],
      ...ids.extra.slice(0, 6),
    ]);
    expect(second.rows.find((r) => r.id === ids.extra[0])?.overdueDays).toBe(0);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(
      27,
    );
    expect((await decisionData(pm, query)).rows.map((r) => r.id)).toEqual(
      first.rows.map((r) => r.id),
    );
    const all = await decisionData(pm, {
      ...query,
      taskView: "ALL",
      dateField: "STOCK",
    });
    expect(all.total).toBe(28);
    const created = await decisionData(pm, { ...query, taskView: "ALL" });
    expect(created.total).toBe(7);
    expect(
      (
        await decisionData(pm, {
          ...query,
          status: "CANCELLED",
          taskView: "ALL",
          dateField: "STOCK",
        })
      ).rows.map((r) => r.id),
    ).toEqual([ids.canceled]);
    const frozen = await decisionData(pm, {
      dimension: "tasks",
      personId: member,
      projectId: ids.frozen,
      taskView: "FROZEN",
    });
    expect(frozen.total).toBe(1);
    expect(frozen.rows[0]).toMatchObject({ id: ids.backlog, overdueDays: 0 });
    expect(frozen.personTasks).toMatchObject({
      current: 0,
      overdue: 0,
      frozen: 1,
    });
    const hiddenWork = await decisionData(pm, { ...query, projectId: hidden });
    expect(hiddenWork.rows).toEqual([]);
    expect(hiddenWork.personTasks).toEqual({
      current: 0,
      inProgress: 0,
      overdue: 0,
      blocked: 0,
      frozen: 0,
    });
    await decisionData(pm, query, { ip: "127.0.0.1" }, true);
    const exported = await db.auditLog.findFirstOrThrow({
      where: { entityType: "DecisionCenter", action: "DATA_EXPORTED" },
      orderBy: { createdAt: "desc" },
    });
    expect(exported.after).toMatchObject({
      query: { taskView: "CURRENT", taskSort: "FOLLOW_UP" },
      rows: 20,
    });
  });
  it("changes the overdue boundary at Hong Kong midnight without flagging frozen or completed tasks", async () => {
    const projectId = (
      await db.$transaction((tx) =>
        tx.project.create({
          data: { name: "人员日期边界（合成）", status: "ACTIVE", ownerId: pm },
        }),
      )
    ).id;
    await db.$transaction(async (tx) => {
      await tx.projectMember.create({ data: { projectId, userId: member } });
      await tx.task.create({
        data: {
          projectId,
          assigneeId: member,
          title: "香港日期11月1日到期",
          status: "IN_PROGRESS",
          dueDate: new Date("2026-11-01T00:00:00Z"),
        },
      });
    });
    const query = decisionQuerySchema.parse({
      dimension: "tasks",
      projectId,
      personId: member,
    });
    const before = await db.$transaction((tx) =>
      taskDecision(
        tx,
        { id: pm, role: "PM" },
        query,
        new Date("2026-11-01T15:59:59.999Z"),
      ),
    );
    const after = await db.$transaction((tx) =>
      taskDecision(
        tx,
        { id: pm, role: "PM" },
        query,
        new Date("2026-11-01T16:00:00.000Z"),
      ),
    );
    expect(before.rows[0].overdueDays).toBe(0);
    expect(after.rows[0].overdueDays).toBe(1);
  });
});
