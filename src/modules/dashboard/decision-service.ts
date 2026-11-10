import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { lockBusinessActor } from "@/modules/auth/project-access";
import {
  recordAudit,
  type AuditRequestMetadata,
} from "@/modules/audit/service";
import { dashboardScope } from "./scope";
import { calendarDateTime, businessToday } from "@/modules/tasks/plan";
import { decisionQuerySchema, type DecisionData } from "./decision-schema";
import {
  handledEvidence,
  observationRows,
  peopleDecision,
  personEvidence,
  personTaskSummary,
  projectDecision,
  requirementDecision,
  taskDecision,
} from "./decision-repositories";
const number = (v: unknown) => Number(v ?? 0);
export async function decisionData(
  actorId: string,
  raw: unknown,
  metadata?: AuditRequestMetadata,
  exportRequested = false,
): Promise<
  DecisionData & { events: Record<string, string | number | null>[] }
> {
  const q = decisionQuerySchema.parse(raw);
  const now = new Date();
  return prisma.$transaction(
    async (tx) => {
      const user = await lockBusinessActor(tx, actorId, ["ADMIN", "PMO", "PM"]);
      const actor = { id: actorId, role: user.role };
      const result =
        q.dimension === "projects"
          ? await projectDecision(tx, actor, q, now)
          : q.dimension === "tasks"
            ? await taskDecision(tx, actor, q, now)
            : q.dimension === "requirements"
              ? await requirementDecision(tx, actor, q, now)
              : await peopleDecision(tx, actor, q, now);
      const metrics: DecisionData["metrics"] = [
        {
          label: "筛选结果",
          value: result.total,
          detail: "与下方明细使用同一权限和筛选条件",
        },
      ];
      if (result.kind === "projects") {
        metrics.push(
          {
            label: "进行中项目",
            value: number(result.summary.active),
            detail: "当前筛选范围内的 ACTIVE 项目",
          },
          {
            label: "暂停项目",
            value: number(result.summary.paused),
            detail: "暂停积压与执行负荷分开解释",
          },
          {
            label: "待验收项目",
            value: number(result.summary.pending),
            detail: "已进入结项审查流程",
          },
          {
            label: "执行项目逾期任务",
            value: number(result.summary.overdue),
            detail: "仅计规划中 / 进行中项目的有效未完成任务",
          },
          {
            label: "当前轮次签名缺口",
            value: number(result.summary.signatureMissing),
            detail: "精确核对签名轮次、实际日期、工时与合法意图",
          },
        );
      }
      if (result.kind === "people") {
        metrics.push(
          {
            label: "有效账号",
            value: number(result.summary.active),
            detail: "筛选范围内的 ACTIVE 账号；不代表本周有空闲",
          },
          {
            label: "持有活跃任务人员",
            value: number(result.summary.loaded),
            detail: "至少负责一个执行项目未完成任务",
          },
          {
            label: "活跃未完成任务",
            value: number(result.summary.openTasks),
            detail: "按当前负责人计数；取消与冻结项目不计入",
          },
          {
            label: "活跃未关闭需求",
            value: number(result.summary.openRequirements),
            detail: "正式需求按当前负责人计数，不与任务相加",
          },
          {
            label: "活跃逾期任务",
            value: number(result.summary.overdue),
            detail: "所选人员负责的执行项目逾期任务",
          },
        );
      }
      if (result.kind === "tasks") {
        const quality = result.quality;
        metrics.push(
          {
            label: "执行项目逾期",
            value: number(quality.activeOverdue),
            detail: "只计规划中、进行中项目的有效未完成任务",
          },
          {
            label: "冻结项目积压",
            value: number(quality.frozenBacklog),
            detail: "暂停、取消、待验收、归档项目另列，不计活跃负荷",
          },
          {
            label: "实际－计划工时",
            value: number(quality.pairs) ? number(quality.variance) : null,
            detail: `仅已完成且计划与实际均有效；${number(quality.pairs)} / ${result.groups.find((g) => g.label === "DONE")?.count ?? 0} 个已完成任务可比`,
          },
          {
            label: "按期完成率",
            value: number(quality.datedDone)
              ? Math.round(
                  (number(quality.onTime) / number(quality.datedDone)) * 100,
                )
              : null,
            detail: `${number(quality.onTime)} / ${number(quality.datedDone)} 个有计划及实际日期的已完成任务（%）`,
          },
          {
            label: "逾期 1–3 / 4–7 / 7+ 天",
            value:
              number(quality.late1) +
              number(quality.late2) +
              number(quality.late3),
            detail: `${number(quality.late1)} / ${number(quality.late2)} / ${number(quality.late3)}`,
          },
        );
      }
      if (result.kind === "requirements") {
        const quality = result.quality;
        metrics.push(
          {
            label: "执行项目逾期需求",
            value: number(quality.overdue),
            detail: "正式需求，排除已关闭、已取消与冻结项目",
          },
          {
            label: "待审变更",
            value: number(quality.changed),
            detail: "同一需求只计一次未完成变更",
          },
          {
            label: "无有效任务覆盖",
            value: number(quality.noTasks),
            detail: "主关联与多对多关联合并判定，不重复计数",
          },
          {
            label: "历史待治理",
            value: number(quality.legacy),
            detail: "未进入新生命周期的历史需求单列",
          },
        );
      }
      const [projects, person, observations, events, personTasks] =
        await Promise.all([
          tx.project.findMany({
            where: dashboardScope(actor),
            select: { id: true, name: true },
            orderBy: { name: "asc" },
            take: 501,
          }),
          personEvidence(tx, actor, q, now),
          q.personId ? Promise.resolve([]) : observationRows(tx, actor, q, now),
          q.personId ? handledEvidence(tx, actor, q, now) : Promise.resolve([]),
          personTaskSummary(tx, actor, q, now),
        ]);
      if (exportRequested)
        await recordAudit(tx, {
          actorId,
          ...metadata,
          action: "DATA_EXPORTED",
          entityType: "DecisionCenter",
          entityId: randomUUID(),
          after: {
            dimension: q.dimension,
            query: JSON.parse(JSON.stringify(q)),
            page: q.page,
            rowIds: result.rows.map((row) => String(row.id)),
            rows: result.rows.length,
            scope: user.role === "PM" ? "PARTICIPATING" : "GLOBAL",
          },
        });
      return {
        dimension: q.dimension,
        generatedAt: now.toISOString(),
        scope: user.role === "PM" ? "PARTICIPATING" : "GLOBAL",
        metrics,
        groups: result.groups,
        rows: result.rows,
        total: result.total,
        page: q.page,
        projects,
        person,
        personTasks,
        observations,
        events,
        notes: [
          ...(q.dimension === "tasks" && q.taskView !== "ALL"
            ? [
                "当前待跟进与冻结积压按当前存量查询，不按新建/完成期间截断；所选日期仍用于历史办理记录。",
              ]
            : []),
          "状态图与明细使用当前筛选范围；创建/完成期间按香港自然日解释。任务及需求的实际完成日期按日历日期查询。",
          "当前责任、项目参与、历史办理分开统计。当前角色不能证明历史角色；旧审计没有角色证据时显示未知。",
          "任务与需求分别计数，不相加为人员负荷。未完成任务预计工时不是剩余工时，也不是利用率。",
          "完成任务的累计实际工时不能作为当周投入；周报申报工时单独统计。",
          ...(result.kind === "requirements"
            ? [
                `期间原始诉求（按创建人/项目范围，独立于正式需求筛选）：${result.intakeGroups.map((g) => `${g.label} ${g.count}`).join("，") || "暂无"}`,
              ]
            : []),
          "历史存量曲线只展示已实际采集的日期；缺少快照的日期不补零、不反推。",
        ],
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
      maxWait: 5000,
    },
  );
}
export async function captureDecisionSnapshots(
  actorId: string,
  metadata: AuditRequestMetadata = {},
) {
  return prisma.$transaction(
    async (tx) => {
      await lockBusinessActor(tx, actorId, ["ADMIN", "PMO"]);
      const day = calendarDateTime(businessToday());
      const today = day;
      const inserted =
        await tx.$executeRaw`INSERT IGNORE INTO DecisionSnapshot (id,projectId,day,recordedAt,projectStatus,taskTotal,taskDone,overdueTasks,openRequirements)
      SELECT UUID(),p.id,${day},UTC_TIMESTAMP(3),p.status,
        (SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status<>'CANCELLED'),
        (SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status='DONE'),
        (SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND t.dueDate<${today} AND p.status IN ('PLANNING','ACTIVE')),
        (SELECT COUNT(*) FROM Requirement r WHERE r.projectId=p.id AND r.managed=TRUE AND r.workflowState NOT IN ('CLOSED','CANCELLED')) FROM Project p`;
      await recordAudit(tx, {
        actorId,
        ...metadata,
        action: "DECISION_SNAPSHOT_CAPTURED",
        entityType: "DecisionSnapshot",
        entityId: randomUUID(),
        after: {
          day: day.toISOString(),
          inserted,
          scope: "GLOBAL",
          firstObservationOnly: true,
        },
      });
      return { day: day.toISOString().slice(0, 10), inserted };
    },
    { timeout: 20000 },
  );
}
