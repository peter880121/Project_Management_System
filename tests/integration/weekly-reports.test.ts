import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  collectWeekly,
  createWeekly,
  exportWeekly,
  reviseWeekly,
  reviewWeekly,
  saveWeekly,
  submitWeekly,
  weeklyDetail,
  weeklyList,
} from "@/modules/weekly-reports/services";
import {
  exemptWeekly,
  weeklyStatistics,
} from "@/modules/weekly-reports/statistics";
import { digest, hkToday, weekWindow } from "@/modules/weekly-reports/policy";
const db = new PrismaClient();
state.db = db.$extends({
  query: {
    auditLog: {
      create: async ({ args, query }) => {
        if (
          state.failAudit &&
          String(args.data.action).startsWith("WEEKLY_REPORT_")
        )
          throw new Error("Synthetic reporting audit outage");
        return query(args);
      },
    },
  },
});
let pm: string,
  other: string,
  member: string,
  admin: string,
  pmo: string,
  project: string,
  second: string;
const actor = (actorId = member) => ({
  actorId,
  ip: "127.0.0.1",
  userAgent: "Synthetic weekly report test",
});
const week = () => hkToday();
async function draft() {
  return createWeekly({ week: week() }, actor());
}
async function saved() {
  const row = await draft();
  return saveWeekly(
    row.id,
    {
      expectedVersion: row.rowVersion,
      sections: [
        {
          id: randomUUID(),
          projectId: project,
          summary: "Synthetic project A progress",
          items: [
            {
              kind: "COMPLETED",
              text: "Synthetic delivered work",
              declaredHours: 2,
            },
          ],
        },
        {
          id: randomUUID(),
          projectId: second,
          summary: "Secret project B",
          items: [],
        },
        {
          id: randomUUID(),
          projectId: null,
          summary: "Private general summary",
          items: [],
        },
      ],
    },
    actor(),
  );
}
describe.sequential("weekly reports on isolated MySQL", () => {
  beforeAll(async () => {
    if (
      !/^medpm_test_ia_/.test(
        new URL(process.env.DATABASE_URL!).pathname.slice(1),
      )
    )
      throw new Error("Isolated database required");
    for (const file of ["rollback.sql", "migration.sql", "migration.sql"])
      execFileSync(
        process.execPath,
        [
          "node_modules/prisma/build/index.js",
          "db",
          "execute",
          "--file",
          `prisma/migrations/20261030000000_weekly_reports/${file}`,
          "--schema",
          "prisma/schema.prisma",
        ],
        { env: process.env, stdio: "pipe", windowsHide: true },
      );
    [pm, other, member, admin, pmo] = await db.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const role of ["PM", "PM", "MEMBER", "ADMIN", "PMO"] as const)
        ids.push(
          (
            await tx.user.create({
              data: {
                email: `${randomUUID()}@medpm.local`,
                name: `Synthetic ${role}`,
                role,
                status: "ACTIVE",
              },
            })
          ).id,
        );
      return ids;
    });
    [project, second] = await db.$transaction(async (tx) => {
      const a = await tx.project.create({
        data: { name: "Synthetic project A", ownerId: pm, status: "ACTIVE" },
      });
      const b = await tx.project.create({
        data: { name: "Synthetic secret B", ownerId: other, status: "ACTIVE" },
      });
      await tx.projectMember.createMany({
        data: [
          { projectId: a.id, userId: member },
          { projectId: b.id, userId: member },
          { projectId: a.id, userId: other },
        ],
      });
      return [a.id, b.id];
    });
  });
  beforeEach(async () => {
    state.failAudit = false;
    // Each case uses a different real author, preserving all immutable evidence.
    member = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `${randomUUID()}@medpm.local`,
          name: "Synthetic employee",
          role: "MEMBER",
          status: "ACTIVE",
        },
      });
      await tx.projectMember.createMany({
        data: [
          { projectId: project, userId: user.id },
          { projectId: second, userId: user.id },
        ],
      });
      return user.id;
    });
  });
  afterAll(() => db.$disconnect());
  it("creates one report per week and safely saves with optimistic locking", async () => {
    const first = await draft();
    const second = await draft();
    expect(second.id).toBe(first.id);
    const row = await saved();
    expect(row.rowVersion).toBe(2);
    await expect(
      saveWeekly(
        row.id,
        {
          expectedVersion: 1,
          sections: row.sections.map(({ id, projectId, summary, items }) => ({
            id,
            projectId,
            summary,
            items,
          })),
        },
        actor(),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("submits an immutable hash-checked snapshot and deduplicates submit retries", async () => {
    const row = await saved();
    const result = await submitWeekly(
      row.id,
      { expectedVersion: row.rowVersion },
      actor(),
    );
    expect(result.state).toBe("SUBMITTED");
    expect(
      (await submitWeekly(row.id, { expectedVersion: row.rowVersion }, actor()))
        .id,
    ).toBe(row.id);
    const revision = await db.weeklyReportRevision.findFirstOrThrow({
      where: { reportId: row.id },
    });
    expect(digest(revision.snapshot)).toBe(revision.sha256);
    await expect(
      db.$executeRaw`UPDATE WeeklyReportRevision SET sha256=${"0".repeat(64)} WHERE id=${revision.id}`,
    ).rejects.toThrow("ER_WEEKLY_EVIDENCE_IMMUTABLE");
    await expect(
      db.$executeRaw`UPDATE WeeklyReportSection SET summary='tampered' WHERE reportId=${row.id}`,
    ).rejects.toThrow("ER_WEEKLY_SUBMITTED_READONLY");
  });
  it("filters every history and export section for the managing PM", async () => {
    let row = await saved();
    row = await submitWeekly(
      row.id,
      { expectedVersion: row.rowVersion },
      actor(),
    );
    const view = await weeklyDetail(row.id, actor(pm));
    expect(view.sections).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain("Secret project B");
    expect(JSON.stringify(view)).not.toContain("Private general summary");
    const exported = await exportWeekly(row.id, actor(pm));
    expect(exported.revisions[0].sections).toHaveLength(1);
    const b = await weeklyDetail(row.id, actor(other));
    expect(b.sections).toHaveLength(1);
    expect(b.sections[0].projectId).toBe(second);
    await expect(
      reviewWeekly(
        row.id,
        {
          expectedVersion: row.rowVersion,
          sectionId: row.sections.find((s) => s.projectId === second)!.id,
          decision: "READ",
          reason: "已阅",
        },
        actor(pm),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("does not give a project participant management visibility", async () => {
    const row = await saved();
    await submitWeekly(row.id, { expectedVersion: row.rowVersion }, actor());
    await db.$transaction((tx) =>
      tx.project.update({ where: { id: second }, data: { ownerId: admin } }),
    );
    try {
      await expect(weeklyDetail(row.id, actor(other))).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      await db.$transaction((tx) =>
        tx.project.update({ where: { id: second }, data: { ownerId: other } }),
      );
    }
  });
  it("retains unchanged project acknowledgment after another section is revised", async () => {
    let row = await saved();
    row = await submitWeekly(
      row.id,
      { expectedVersion: row.rowVersion },
      actor(),
    );
    const a = row.sections.find((s) => s.projectId === project)!;
    await reviewWeekly(
      row.id,
      {
        expectedVersion: row.rowVersion,
        sectionId: a.id,
        decision: "READ",
        reason: "已阅知",
      },
      actor(pm),
    );
    row = await weeklyDetail(row.id, actor());
    const revision1 = row.revisions[0];
    row = await reviseWeekly(
      row.id,
      {
        expectedVersion: row.rowVersion,
        reason: "Synthetic follow-up correction",
      },
      actor(),
    );
    row = await saveWeekly(
      row.id,
      {
        expectedVersion: row.rowVersion,
        sections: row.sections.map((s) => ({
          id: s.id,
          projectId: s.projectId,
          summary: s.projectId === second ? "Changed B only" : s.summary,
          items: s.items,
        })),
      },
      actor(),
    );
    row = await submitWeekly(
      row.id,
      { expectedVersion: row.rowVersion },
      actor(),
    );
    expect(row.revisions).toHaveLength(2);
    expect(row.revisions[1].sections).toEqual(revision1.sections);
    expect(digest(row.sections.find((s) => s.id === a.id))).toBe(
      row.revisions[1].reviews[0].sectionSha256,
    );
  });
  it("requires return reason and prevents self review", async () => {
    let row = await saved();
    row = await submitWeekly(
      row.id,
      { expectedVersion: row.rowVersion },
      actor(),
    );
    await expect(
      reviewWeekly(
        row.id,
        {
          expectedVersion: row.rowVersion,
          sectionId: row.sections[0].id,
          decision: "READ",
          reason: "self",
        },
        actor(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      reviewWeekly(
        row.id,
        {
          expectedVersion: row.rowVersion,
          sectionId: row.sections[0].id,
          decision: "RETURNED",
          reason: "",
        },
        actor(pm),
      ),
    ).rejects.toThrow();
    row = await reviewWeekly(
      row.id,
      {
        expectedVersion: row.rowVersion,
        sectionId: row.sections.find((s) => s.projectId === project)!.id,
        decision: "RETURNED",
        reason: "Please clarify delivery evidence",
      },
      actor(pm),
    );
    expect(row.state).toBe("RETURNED");
  });
  it("rolls back draft writes when audit persistence fails", async () => {
    state.failAudit = true;
    await expect(draft()).rejects.toThrow("Synthetic reporting audit outage");
    expect(await db.weeklyReport.count({ where: { authorId: member } })).toBe(
      0,
    );
  });
  it("collects only own sources, omits already selected work and keeps weekly hours separate", async () => {
    const task = await db.$transaction((tx) =>
      tx.task.create({
        data: {
          projectId: project,
          title: "Synthetic own task",
          assigneeId: member,
          status: "IN_PROGRESS",
          estimateHours: 40,
        },
      }),
    );
    const row = await draft();
    const result = await collectWeekly(row.id, actor());
    expect(result.candidates.some((c) => c.sourceId === task.id)).toBe(true);
    await saveWeekly(
      row.id,
      {
        expectedVersion: row.rowVersion,
        sections: [
          {
            id: randomUUID(),
            projectId: project,
            summary: "",
            items: [
              {
                kind: "ONGOING",
                text: task.title,
                sourceType: "TASK",
                sourceId: task.id,
                declaredHours: 2,
              },
            ],
          },
        ],
      },
      actor(),
    );
    expect(
      (await collectWeekly(row.id, actor())).candidates.some(
        (c) => c.sourceId === task.id,
      ),
    ).toBe(false);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: task.id } })).actualHours,
    ).toBe(null);
  });
  it("rejects forged cross-project sources and membership revocation before commit", async () => {
    const row = await draft();
    const payload = {
      expectedVersion: 1,
      sections: [
        {
          id: randomUUID(),
          projectId: project,
          summary: "",
          items: [
            {
              kind: "COMPLETED",
              text: "fake",
              sourceId: randomUUID(),
              sourceType: "TASK",
            },
          ],
        },
      ],
    };
    await expect(saveWeekly(row.id, payload, actor())).rejects.toMatchObject({
      status: 409,
    });
    await db.$transaction((tx) =>
      tx.projectMember.update({
        where: { projectId_userId: { projectId: project, userId: member } },
        data: { active: false },
      }),
    );
    await expect(
      saveWeekly(
        row.id,
        { ...payload, sections: [{ ...payload.sections[0], items: [] }] },
        actor(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("allows reporting on frozen history without modifying project assets", async () => {
    const frozen = await db.$transaction((tx) =>
      tx.project.create({
        data: {
          name: "Synthetic historical archive",
          status: "ARCHIVED",
          ownerId: member,
        },
      }),
    );
    const row = await draft();
    expect(
      (
        await saveWeekly(
          row.id,
          {
            expectedVersion: 1,
            sections: [
              {
                id: randomUUID(),
                projectId: frozen.id,
                summary: "Historical work record",
                items: [],
              },
            ],
          },
          actor(),
        )
      ).sections[0].projectId,
    ).toBe(frozen.id);
    await expect(
      db.$transaction((tx) =>
        tx.task.create({ data: { projectId: frozen.id, title: "Forbidden" } }),
      ),
    ).rejects.toThrow("ER_ARCHIVED_PROJECT");
  });
  it("uses stable roster, scoped statistics and audited exemption without backfilling old weeks", async () => {
    await weeklyList({ week: week(), mode: "mine" }, actor());
    const window = weekWindow(week());
    const expected = await db.weeklyReportExpectation.count({
      where: { weekStart: window.start },
    });
    let row = await saved();
    row = await submitWeekly(
      row.id,
      { expectedVersion: row.rowVersion },
      actor(),
    );
    const stats = await weeklyStatistics({ week: week() }, admin);
    expect(stats.required).toBe(expected);
    expect(stats.declaredHours).toBeGreaterThanOrEqual(2);
    const scoped = await weeklyStatistics(
      { week: week(), projectId: second },
      pm,
    );
    expect(scoped.sections).toBe(0);
    expect(scoped.declaredHours).toBe(0);
    expect(scoped.required).toBe(null);
    await expect(
      weeklyStatistics({ week: week() }, member),
    ).rejects.toMatchObject({ status: 403 });
    const historical = await weeklyStatistics({ week: "2020-01-01" }, admin);
    expect(historical.required).toBe(null);
    expect(historical.rosterCaptured).toBe(false);
    const expectation = await db.weeklyReportExpectation.findFirstOrThrow({
      where: { weekStart: window.start },
    });
    await exemptWeekly(
      {
        authorId: expectation.authorId,
        week: week(),
        reason: "Synthetic approved leave",
      },
      actor(pmo),
    );
    expect((await weeklyStatistics({ week: week() }, admin)).required).toBe(
      expected - 1,
    );
  });
  it("blocks rollback once reporting evidence exists", async () => {
    await saved();
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "node_modules/prisma/build/index.js",
          "db",
          "execute",
          "--file",
          "prisma/migrations/20261030000000_weekly_reports/rollback.sql",
          "--schema",
          "prisma/schema.prisma",
        ],
        { env: process.env, stdio: "pipe", windowsHide: true },
      ),
    ).toThrow();
  });
});
