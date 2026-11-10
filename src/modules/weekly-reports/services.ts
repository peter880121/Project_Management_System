import { initializePeriod } from "./repositories";
import { Prisma, type Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lockBusinessActor } from "@/modules/auth/project-access";
import { lockProject } from "@/modules/auth/transaction-locks";
import {
  recordAudit,
  type AuditRequestMetadata,
} from "@/modules/audit/service";
import { ProjectError } from "@/modules/projects/services";
import {
  dateSchema,
  digest,
  hkToday,
  reviewSchema,
  saveSchema,
  versionSchema,
  visibleSections,
  weekWindow,
  type ReportSnapshot,
  type SnapshotSection,
} from "./policy";

type Tx = Prisma.TransactionClient;
function reportTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  options: { timeout?: number } = {},
) {
  return prisma.$transaction(work, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 15000,
    ...options,
  });
}
type Actor = { actorId: string } & AuditRequestMetadata;
const roles: Role[] = ["ADMIN", "PMO", "PM", "QA", "MEMBER"];
const globalRole = (role: Role) => ["ADMIN", "PMO"].includes(role);
const fail = (message: string, status = 409): never => {
  throw new ProjectError(message, status);
};
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const audit = (
  tx: Tx,
  actor: Actor,
  id: string,
  action: Parameters<typeof recordAudit>[1]["action"],
  after: unknown,
) =>
  recordAudit(tx, {
    ...actor,
    action,
    entityType: "WeeklyReport",
    entityId: id,
    after: json(after),
  });
export const weeklyQuery = z
  .object({
    week: dateSchema.optional(),
    mode: z.enum(["mine", "inbox", "ledger"]).default("mine"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    authorId: z.uuid().optional(),
    projectId: z.uuid().optional(),
  })
  .strict();

async function actor(tx: Tx, input: Actor) {
  return {
    ...(await lockBusinessActor(tx, input.actorId, roles)),
    id: input.actorId,
  };
}
// Reporting is a user activity. These records never call a project business-write bypass.
async function projects(
  tx: Tx,
  user: { id: string; role: Role },
  ownedOnly = false,
) {
  return tx.project.findMany({
    where: globalRole(user.role)
      ? {}
      : ownedOnly
        ? { ownerId: user.id }
        : {
            OR: [
              { ownerId: user.id },
              { members: { some: { userId: user.id, active: true } } },
            ],
          },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
    take: 501,
  });
}

function snapshot(row: {
  sections: Array<{
    id: string;
    projectId: string | null;
    projectName: string;
    summary: string;
    items: Array<{
      kind: string;
      text: string;
      sourceType: string | null;
      sourceId: string | null;
      targetDate: Date | null;
      declaredHours: Prisma.Decimal | null;
    }>;
  }>;
}): SnapshotSection[] {
  return row.sections.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    projectName: s.projectName,
    summary: s.summary,
    items: s.items.map((i) => ({
      kind: i.kind as SnapshotSection["items"][number]["kind"],
      text: i.text,
      sourceType:
        i.sourceType as SnapshotSection["items"][number]["sourceType"],
      sourceId: i.sourceId,
      targetDate: i.targetDate?.toISOString().slice(0, 10) ?? null,
      declaredHours: i.declaredHours === null ? null : Number(i.declaredHours),
    })),
  }));
}
const include = {
  sections: {
    include: { items: { orderBy: { position: "asc" as const } } },
    orderBy: { id: "asc" as const },
  },
  revisions: {
    orderBy: { version: "desc" as const },
    include: { reviews: true },
  },
};
async function read(tx: Tx, id: string, user: { id: string; role: Role }) {
  const row = await tx.weeklyReport.findUnique({ where: { id }, include });
  if (!row) return fail("周报不存在", 404);
  const own = row.authorId === user.id;
  const owned = new Set((await projects(tx, user, true)).map((p) => p.id));
  if (
    !own &&
    !globalRole(user.role) &&
    (user.role !== "PM" || !row.revisions.length)
  )
    return fail("无权查看该周报", 403);
  const revision = row.revisions[0];
  if (revision && digest(revision.snapshot) !== revision.sha256)
    return fail("周报证据校验失败");
  const data = own
    ? snapshot(row)
    : ((revision?.snapshot as ReportSnapshot | undefined)?.sections ?? []);
  const visible = visibleSections(data, own, globalRole(user.role), owned);
  if (!own && !globalRole(user.role) && !visible.length)
    return fail("无权查看该周报", 403);
  const author = await tx.user.findUnique({
    where: { id: row.authorId },
    select: { name: true, role: true },
  });
  const revisions = row.revisions.map((r) => {
    const content = r.snapshot as ReportSnapshot;
    return {
      id: r.id,
      version: r.version,
      submittedAt: r.submittedAt,
      sections: visibleSections(
        content.sections,
        own,
        globalRole(user.role),
        owned,
      ),
      reviews: r.reviews.filter((review) =>
        visible.some((s) => s.id === review.sectionId),
      ),
      ...(own || globalRole(user.role) ? { sha256: r.sha256 } : {}),
    };
  });
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: author?.name ?? "历史账号",
    weekStart: row.weekStart,
    state: row.state,
    rowVersion: row.rowVersion,
    submittedAt: row.submittedAt,
    sections: visible,
    revisions,
    own,
    canReview: !own && (globalRole(user.role) || user.role === "PM"),
    editable: own && ["DRAFT", "RETURNED"].includes(row.state),
  };
}
export async function weeklyList(raw: unknown, input: Actor) {
  const q = weeklyQuery.parse(raw);
  return reportTransaction(async (tx) => {
    const user = await actor(tx, input);
    const week = q.week ?? hkToday();
    await initializePeriod(tx, hkToday());
    const window = await initializePeriod(tx, week);
    if (q.mode !== "mine" && !globalRole(user.role) && user.role !== "PM")
      return fail("无权查看管理台账", 403);
    const owned = await projects(tx, user, true);
    const where: Prisma.WeeklyReportWhereInput = {
      ...(q.mode === "inbox"
        ? { state: "SUBMITTED", NOT: { authorId: user.id } }
        : {}),
      ...(q.week ? { weekStart: window.start } : {}),
      ...(q.mode === "mine"
        ? { authorId: user.id }
        : {
            revisions: { some: {} },
            ...(!globalRole(user.role)
              ? {
                  sections: {
                    some: { projectId: { in: owned.map((p) => p.id) } },
                  },
                }
              : {}),
          }),
      ...(q.authorId && q.mode !== "mine" ? { authorId: q.authorId } : {}),
      ...(q.projectId
        ? {
            sections: {
              some: {
                projectId: q.projectId,
                ...(!globalRole(user.role) && q.mode !== "mine"
                  ? {
                      projectId: {
                        in: owned
                          .filter((p) => p.id === q.projectId)
                          .map((p) => p.id),
                      },
                    }
                  : {}),
              },
            },
          }
        : {}),
    };
    const rows = await tx.weeklyReport.findMany({
      where,
      select: {
        id: true,
        authorId: true,
        weekStart: true,
        state: true,
        submittedAt: true,
        rowVersion: true,
      },
      orderBy: [{ weekStart: "desc" }, { id: "asc" }],
      skip: (q.page - 1) * 20,
      take: 20,
    });
    const authors = await tx.user.findMany({
      where: { id: { in: rows.map((r) => r.authorId) } },
      select: { id: true, name: true, role: true },
    });
    return {
      rows: rows.map((r) => ({
        ...r,
        author: authors.find((a) => a.id === r.authorId),
      })),
      total: await tx.weeklyReport.count({ where }),
      projects: await projects(tx, user),
      canManage: globalRole(user.role) || user.role === "PM",
      globalManage: globalRole(user.role),
      deadline:
        (
          await tx.weeklyReportPeriod.findUnique({
            where: { weekStart: window.start },
          })
        )?.deadline ?? window.deadline,
      week: window.label,
    };
  });
}
export async function createWeekly(raw: unknown, input: Actor) {
  const { week } = z.object({ week: dateSchema }).strict().parse(raw);
  return reportTransaction(async (tx) => {
    await actor(tx, input);
    await initializePeriod(tx, hkToday());
    const w = await initializePeriod(tx, week);
    if (w.start > weekWindow(hkToday()).end)
      return fail("只能提前准备下一周草稿", 400);
    const row = await tx.weeklyReport.upsert({
      where: {
        authorId_weekStart: { authorId: input.actorId, weekStart: w.start },
      },
      create: { authorId: input.actorId, weekStart: w.start },
      update: {},
    });
    await audit(tx, input, row.id, "WEEKLY_REPORT_DRAFTED", {
      weekStart: w.start,
    });
    return row;
  });
}
export const weeklyDetail = (id: string, input: Actor) =>
  reportTransaction(async (tx) =>
    read(tx, z.uuid().parse(id), await actor(tx, input)),
  );

async function validateSources(
  tx: Tx,
  sections: SnapshotSection[],
  userId: string,
) {
  const refs = sections.flatMap((section) =>
    section.items
      .filter((item) => item.sourceId)
      .map((item) => ({ ...item, projectId: section.projectId })),
  );
  if (refs.some((item) => !item.projectId))
    return fail("业务来源必须放入对应项目分区", 400);
  const ids = (type: string) =>
    refs
      .filter((item) => item.sourceType === type)
      .map((item) => item.sourceId!);
  const select = { id: true, projectId: true } as const;
  // Five bounded, batched queries regardless of the number of work items.
  const [tasks, requirements, meetings, deliverables, events] =
    await Promise.all([
      tx.task.findMany({
        where: { id: { in: ids("TASK") }, assigneeId: userId },
        select,
      }),
      tx.requirement.findMany({
        where: { id: { in: ids("REQUIREMENT") }, ownerId: userId },
        select,
      }),
      tx.meetingRecord.findMany({
        where: { id: { in: ids("MEETING") }, createdById: userId },
        select,
      }),
      tx.deliverable.findMany({
        where: { id: { in: ids("DELIVERABLE") }, createdById: userId },
        select,
      }),
      tx.auditLog.findMany({
        where: { id: { in: ids("AUDIT") }, actorId: userId },
        select,
      }),
    ]);
  const valid = new Set([
    ...tasks.map((item) => `TASK:${item.id}:${item.projectId}`),
    ...requirements.map((item) => `REQUIREMENT:${item.id}:${item.projectId}`),
    ...meetings.map((item) => `MEETING:${item.id}:${item.projectId}`),
    ...deliverables.map((item) => `DELIVERABLE:${item.id}:${item.projectId}`),
    ...events.map((item) => `AUDIT:${item.id}:${item.projectId}`),
  ]);
  if (
    refs.some(
      (item) =>
        !valid.has(`${item.sourceType}:${item.sourceId}:${item.projectId}`),
    )
  )
    return fail("工作来源已变化或不属于本人，请重新汇总", 409);
}

export async function saveWeekly(id: string, raw: unknown, input: Actor) {
  const data = saveSchema.parse(raw);
  return reportTransaction(
    async (tx) => {
      // Preserve project -> user lock order when membership revocation races with save.
      for (const pid of [
        ...new Set(
          data.sections.flatMap((s) => (s.projectId ? [s.projectId] : [])),
        ),
      ].sort())
        await lockProject(tx, pid);
      const user = await actor(tx, input);
      await tx.$queryRaw`SELECT id FROM WeeklyReport WHERE id=${id} FOR UPDATE`;
      const row = await tx.weeklyReport.findUnique({ where: { id } });
      if (!row || row.authorId !== user.id) return fail("无权修改周报", 403);
      if (
        !["DRAFT", "RETURNED"].includes(row.state) ||
        row.rowVersion !== data.expectedVersion
      )
        return fail("周报已变化，请刷新后重试");
      const allowed = await projects(tx, user);
      const map = new Map(allowed.map((p) => [p.id, p.name]));
      const sections = data.sections.map((s) => {
        if (s.projectId && !map.has(s.projectId))
          return fail("项目访问权限已变更", 403);
        return {
          ...s,
          projectName: s.projectId ? map.get(s.projectId)! : "非项目工作",
        };
      });
      await validateSources(tx, sections, user.id);
      // Stable section IDs preserve reviews of unchanged content across resubmissions.
      const conflicting = await tx.weeklyReportSection.count({
        where: { id: { in: sections.map((s) => s.id) }, reportId: { not: id } },
      });
      if (conflicting) return fail("分区标识已被使用");
      await tx.weeklyReportItem.deleteMany({
        where: { section: { reportId: id } },
      });
      await tx.weeklyReportSection.deleteMany({ where: { reportId: id } });
      for (const section of sections)
        await tx.weeklyReportSection.create({
          data: {
            id: section.id,
            reportId: id,
            projectId: section.projectId,
            projectName: section.projectName,
            summary: section.summary,
            items: {
              create: section.items.map((item, position) => ({
                ...item,
                position,
                targetDate: item.targetDate
                  ? new Date(`${item.targetDate}T00:00:00.000Z`)
                  : null,
              })),
            },
          },
        });
      await tx.weeklyReport.update({
        where: { id },
        data: { rowVersion: { increment: 1 } },
      });
      await audit(tx, input, id, "WEEKLY_REPORT_UPDATED", {
        sectionCount: sections.length,
        rowVersion: row.rowVersion + 1,
      });
      return read(tx, id, user);
    },
    { timeout: 15000 },
  );
}
export async function submitWeekly(id: string, raw: unknown, input: Actor) {
  const data = versionSchema.parse(raw);
  return reportTransaction(
    async (tx) => {
      const refs = await tx.weeklyReportSection.findMany({
        where: { reportId: id },
        select: { projectId: true },
      });
      for (const pid of [
        ...new Set(refs.flatMap((s) => (s.projectId ? [s.projectId] : []))),
      ].sort())
        await lockProject(tx, pid);
      const user = await actor(tx, input);
      await tx.$queryRaw`SELECT id FROM WeeklyReport WHERE id=${id} FOR UPDATE`;
      const row = await tx.weeklyReport.findUnique({ where: { id }, include });
      if (!row || row.authorId !== user.id) return fail("无权提交周报", 403);
      if (
        row.state === "SUBMITTED" &&
        row.rowVersion === data.expectedVersion + 1
      )
        return read(tx, id, user);
      if (
        !["DRAFT", "RETURNED"].includes(row.state) ||
        row.rowVersion !== data.expectedVersion
      )
        return fail("周报已变化，请刷新后重试");
      if (row.weekStart > weekWindow(hkToday()).start)
        return fail("未来周只能保存草稿，不能提前计为已报", 400);
      const sections = snapshot(row);
      saveSchema.parse({
        expectedVersion: data.expectedVersion,
        sections: sections.map((s) => ({
          id: s.id,
          projectId: s.projectId,
          summary: s.summary,
          items: s.items,
        })),
      });
      if (!sections.some((s) => s.summary.trim() || s.items.length))
        return fail("请先填写本周工作", 400);
      const allowed = new Set((await projects(tx, user)).map((p) => p.id));
      if (sections.some((s) => s.projectId && !allowed.has(s.projectId)))
        return fail("项目访问权限已变更，请移除无权提交的分区", 403);
      await validateSources(tx, sections, user.id);
      const author = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { name: true },
      });
      const content: ReportSnapshot = {
        sections,
        sectionHashes: Object.fromEntries(
          sections.map((s) => [s.id, digest(s)]),
        ),
        authorRole: user.role,
        authorName: author.name,
        weekStart: row.weekStart.toISOString(),
      };
      const revision = await tx.weeklyReportRevision.create({
        data: {
          reportId: id,
          version: (row.revisions[0]?.version ?? 0) + 1,
          snapshot: json(content),
          sha256: digest(content),
        },
      });
      await tx.weeklyReport.update({
        where: { id },
        data: {
          state: "SUBMITTED",
          submittedAt: revision.submittedAt,
          rowVersion: { increment: 1 },
        },
      });
      await audit(tx, input, id, "WEEKLY_REPORT_SUBMITTED", {
        revisionId: revision.id,
        sha256: revision.sha256,
        authorRole: user.role,
      });
      return read(tx, id, user);
    },
    { timeout: 15000 },
  );
}
export async function reviewWeekly(id: string, raw: unknown, input: Actor) {
  const data = reviewSchema.parse(raw);
  return reportTransaction(async (tx) => {
    const section = await tx.weeklyReportSection.findUnique({
      where: { id: data.sectionId },
    });
    if (section?.projectId) await lockProject(tx, section.projectId);
    const user = await actor(tx, input);
    await tx.$queryRaw`SELECT id FROM WeeklyReport WHERE id=${id} FOR UPDATE`;
    const row = await read(tx, id, user);
    if (!row.canReview) return fail("不能阅知自己的周报", 403);
    if (row.state !== "SUBMITTED" || row.rowVersion !== data.expectedVersion)
      return fail("周报版本已变化");
    const revision = row.revisions[0];
    const target = revision.sections.find((s) => s.id === data.sectionId);
    if (!target) return fail("无权阅知该分区", 403);
    await tx.weeklyReportReview.create({
      data: {
        revisionId: revision.id,
        sectionId: target.id,
        sectionSha256: digest(target),
        actorId: user.id,
        decision: data.decision,
        reason: data.reason,
      },
    });
    await tx.weeklyReport.update({
      where: { id },
      data: {
        ...(data.decision === "RETURNED" ? { state: "RETURNED" } : {}),
        rowVersion: { increment: 1 },
      },
    });
    await audit(
      tx,
      input,
      id,
      data.decision === "RETURNED"
        ? "WEEKLY_REPORT_RETURNED"
        : "WEEKLY_REPORT_READ",
      {
        revisionId: revision.id,
        sectionId: target.id,
        decision: data.decision,
        reason: data.reason,
      },
    );
    return read(tx, id, user);
  });
}
export async function collectWeekly(id: string, input: Actor) {
  return reportTransaction(async (tx) => {
    const user = await actor(tx, input);
    const row = await read(tx, id, user);
    if (!row.own) return fail("只能汇总本人工作", 403);
    const start = new Date(row.weekStart);
    const end = new Date(start.getTime() + 7 * 86400000);
    const allowed = await projects(tx, user);
    const ids = allowed.map((p) => p.id);
    const range = { gte: start, lt: end };
    const [tasks, requirements, deliverables, meetings, events] =
      await Promise.all([
        tx.task.findMany({
          where: {
            projectId: { in: ids },
            assigneeId: user.id,
            OR: [
              { status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } },
              { status: "DONE", completedAt: range },
            ],
          },
          select: { id: true, projectId: true, title: true, status: true },
          take: 201,
          orderBy: { id: "asc" },
        }),
        tx.requirement.findMany({
          where: {
            projectId: { in: ids },
            ownerId: user.id,
            OR: [
              { workflowState: { notIn: ["CLOSED", "CANCELLED"] } },
              { completedAt: range },
            ],
          },
          select: {
            id: true,
            projectId: true,
            title: true,
            workflowState: true,
          },
          take: 201,
          orderBy: { id: "asc" },
        }),
        tx.deliverable.findMany({
          where: {
            projectId: { in: ids },
            createdById: user.id,
            createdAt: range,
          },
          select: { id: true, projectId: true, name: true },
          take: 201,
          orderBy: { id: "asc" },
        }),
        tx.meetingRecord.findMany({
          where: {
            projectId: { in: ids },
            createdById: user.id,
            createdAt: range,
          },
          select: { id: true, projectId: true, title: true },
          take: 201,
          orderBy: { id: "asc" },
        }),
        tx.auditLog.findMany({
          where: {
            projectId: { in: ids },
            actorId: user.id,
            createdAt: range,
            action: {
              in: [
                "DELIVERABLE_REVIEWED",
                "TASK_SIGNED_AND_COMPLETED",
                "REQUIREMENT_WORKFLOW_CHANGED",
              ],
            },
          },
          select: { id: true, projectId: true, action: true },
          take: 201,
          orderBy: { id: "asc" },
        }),
      ]);
    const existing = new Set(
      row.sections.flatMap((s) =>
        s.items.map((i) => `${i.sourceType}:${i.sourceId}`),
      ),
    );
    const candidates = [
      ...tasks.map((t) => ({
        projectId: t.projectId,
        sourceType: "TASK",
        sourceId: t.id,
        text: `任务：${t.title}（${t.status}）`,
        kind: t.status === "DONE" ? "COMPLETED" : "ONGOING",
      })),
      ...requirements.map((r) => ({
        projectId: r.projectId,
        sourceType: "REQUIREMENT",
        sourceId: r.id,
        text: `需求：${r.title}（${r.workflowState}）`,
        kind: r.workflowState === "CLOSED" ? "COMPLETED" : "ONGOING",
      })),
      ...deliverables.map((d) => ({
        projectId: d.projectId,
        sourceType: "DELIVERABLE",
        sourceId: d.id,
        text: `新增交付物：${d.name}`,
        kind: "COMPLETED",
      })),
      ...meetings.map((m) => ({
        projectId: m.projectId,
        sourceType: "MEETING",
        sourceId: m.id,
        text: `记录会议：${m.title}`,
        kind: "COMPLETED",
      })),
      ...events.map((e) => ({
        projectId: e.projectId,
        sourceType: "AUDIT",
        sourceId: e.id,
        text: `参与审核/签署：${e.action}`,
        kind: "COMPLETED",
      })),
    ].filter((c) => !existing.has(`${c.sourceType}:${c.sourceId}`));
    return {
      candidates,
      truncated: [tasks, requirements, deliverables, meetings, events].some(
        (rows) => rows.length > 200,
      ),
    };
  });
}
export async function exportWeekly(id: string, input: Actor) {
  return reportTransaction(async (tx) => {
    const row = await read(tx, id, await actor(tx, input));
    await audit(tx, input, id, "DATA_EXPORTED", {
      scope: "WEEKLY_REPORT",
      sectionIds: row.sections.map((s) => s.id),
      rowVersion: row.rowVersion,
    });
    return row;
  });
}

export async function reviseWeekly(id: string, raw: unknown, input: Actor) {
  const data = versionSchema
    .extend({ reason: z.string().trim().min(5).max(1000) })
    .parse(raw);
  return reportTransaction(async (tx) => {
    const user = await actor(tx, input);
    await tx.$queryRaw`SELECT id FROM WeeklyReport WHERE id=${id} FOR UPDATE`;
    const row = await tx.weeklyReport.findUnique({ where: { id } });
    if (!row || row.authorId !== user.id) return fail("只能修订本人周报", 403);
    if (row.state !== "SUBMITTED" || row.rowVersion !== data.expectedVersion)
      return fail("周报版本已变化");
    await tx.weeklyReport.update({
      where: { id },
      data: { state: "RETURNED", rowVersion: { increment: 1 } },
    });
    await audit(tx, input, id, "WEEKLY_REPORT_REVISION_STARTED", {
      reason: data.reason,
      previousVersion: row.rowVersion,
    });
    return read(tx, id, user);
  });
}
