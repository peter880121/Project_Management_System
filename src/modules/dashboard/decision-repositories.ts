import { liveRiskTaskClause } from "@/modules/ai/risk/visibility";
import { missingSignature } from "./signature-gap";
import { Prisma, type TaskStatus } from "@prisma/client";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { dashboardScope, dashboardSqlScope } from "./scope";
import { calendarDateTime, businessToday } from "@/modules/tasks/plan";
import {
  decisionDates,
  type DecisionCell,
  type DecisionQuery,
  type DecisionRow,
} from "./decision-schema";

type Tx = Prisma.TransactionClient;
export const size = 20;
const liveStatuses = ["PLANNING", "ACTIVE"] as const;
const openTask: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED"];
export const contributionActions = [
  "TASK_CREATED",
  "TASK_SIGNED_AND_COMPLETED",
  "TASK_REOPENED",
  "TASK_CANCELLED",
  "REQUIREMENT_CREATED",
  "REQUIREMENT_WORKFLOW_CHANGED",
  "TEST_CASE_CREATED",
  "TEST_CASE_UPDATED",
  "DELIVERABLE_CREATED",
  "DELIVERABLE_REVIEWED",
  "MEETING_CREATED",
  "MEETING_FINALIZED",
  "PROJECT_QA_APPROVED",
  "PROJECT_ARCHIVED",
];
const contribution = Prisma.sql`a.action IN (${Prisma.join(contributionActions)})`;
export function plain(rows: Record<string, unknown>[]): DecisionRow[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]): [string, DecisionCell] => [
        key,
        value === null
          ? null
          : typeof value === "boolean"
            ? Number(value)
            : value instanceof Date
              ? value.toISOString()
              : typeof value === "bigint" || value instanceof Prisma.Decimal
                ? Number(value)
                : typeof value === "number" || typeof value === "string"
                  ? value
                  : String(value),
      ]),
    ),
  );
}
function search(column: Prisma.Sql, text: string) {
  return text ? Prisma.sql`LOCATE(${text},${column})>0` : Prisma.sql`TRUE`;
}
export function projectPerson(q: DecisionQuery) {
  if (!q.personId) return Prisma.sql`TRUE`;
  if (q.relation === "RESPONSIBLE") return Prisma.sql`p.ownerId=${q.personId}`;
  if (q.relation === "PARTICIPATING")
    return Prisma.sql`(p.ownerId=${q.personId} OR EXISTS(SELECT 1 FROM ProjectMember m WHERE m.projectId=p.id AND m.userId=${q.personId} AND m.active=TRUE))`;
  return Prisma.sql`EXISTS(SELECT 1 FROM AuditLog a WHERE a.projectId=p.id AND a.actorId=${q.personId} AND ${contribution})`;
}
function dateScope(
  column: Prisma.Sql,
  q: DecisionQuery,
  now: Date,
  calendar = false,
) {
  if (q.dateField === "STOCK") return Prisma.sql`TRUE`;
  const dates = decisionDates(q, now);
  const start = calendar
    ? new Date(`${dates.from}T00:00:00.000Z`)
    : dates.start;
  const end = calendar
    ? new Date(new Date(`${dates.to}T00:00:00.000Z`).getTime() + 86400000)
    : dates.end;
  return Prisma.sql`${column}>=${start} AND ${column}<${end}`;
}
export async function projectDecision(
  tx: Tx,
  actor: AuthenticatedUser,
  q: DecisionQuery,
  now: Date,
) {
  const scope = Prisma.sql`${dashboardSqlScope(actor, q.projectId)} AND ${projectPerson(q)} AND ${search(Prisma.sql`p.name`, q.q)} AND ${q.status ? Prisma.sql`p.status=${q.status}` : Prisma.sql`TRUE`} AND ${dateScope(q.dateField === "COMPLETED" ? Prisma.sql`p.archivedAt` : Prisma.sql`p.createdAt`, q, now)}`;
  const today = calendarDateTime(businessToday(now));
  const [rows, count] = await Promise.all([
    tx.$queryRaw<
      Record<string, unknown>[]
    >(Prisma.sql`SELECT p.id,p.name title,p.status,owner.name ownerName,p.createdAt,
      (SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status<>'CANCELLED') taskTotal,
      (SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status='DONE') taskDone,
      (SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status='DONE' AND ${missingSignature}) signatureGaps,
      (SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND t.dueDate<${today}) overdueTasks,
      (SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status='BLOCKED') blocked,
      (SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND (t.dueDate IS NULL OR t.plannedStartDate IS NULL)) unscheduled,
      (SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status<>'CANCELLED' AND t.requiresDeliverable=TRUE AND NOT EXISTS(SELECT 1 FROM Deliverable d JOIN Document doc ON doc.id=d.documentId WHERE d.taskId=t.id AND d.projectId=p.id AND d.status='APPROVED' AND doc.storageStatus='AVAILABLE' AND doc.sha256 IS NOT NULL)) missingDeliverables,
      (SELECT COUNT(*) FROM Requirement r WHERE r.projectId=p.id AND r.managed=TRUE AND r.workflowState NOT IN ('CLOSED','CANCELLED')) openRequirements,
      (SELECT COUNT(*) FROM Requirement r WHERE r.projectId=p.id AND r.workflowState='CUSTOMER_CONFIRMATION' AND r.managed=TRUE) customerPending,
      (SELECT COUNT(*) FROM RequirementChangeRequest c WHERE c.projectId=p.id AND c.state IN ('DRAFT','IN_REVIEW')) pendingChanges,
      (SELECT COUNT(*) FROM AiSuggestion s WHERE s.projectId=p.id AND s.type='RISK' AND s.status='PENDING' AND s.createdAt>=${new Date(now.getTime() - 7 * 86400000)} AND ${liveRiskTaskClause}) recentRiskNotices,
      COALESCE((SELECT c.createdAt FROM ProjectStatusChange c WHERE c.id=p.currentStatusChangeId),p.createdAt) statusSince
      FROM Project p LEFT JOIN User owner ON owner.id=p.ownerId WHERE ${scope}
      ORDER BY p.createdAt DESC,p.id ASC LIMIT ${size} OFFSET ${(q.page - 1) * size}`),
    tx.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) total FROM Project p WHERE ${scope}`,
    ),
  ]);
  const groups = await tx.$queryRaw<{ label: string; count: bigint }[]>(
    Prisma.sql`SELECT p.status label,COUNT(*) count FROM Project p WHERE ${scope} GROUP BY p.status`,
  );
  const [summary] = await tx.$queryRaw<
    {
      active: bigint;
      paused: bigint;
      pending: bigint;
      overdue: bigint;
      signatureMissing: bigint;
    }[]
  >(Prisma.sql`
    SELECT SUM(p.status='ACTIVE') active,SUM(p.status='ON_HOLD') paused,SUM(p.status='PENDING_ACCEPTANCE') pending,
      SUM((SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND t.dueDate<${today} AND p.status IN ('PLANNING','ACTIVE'))) overdue,
      SUM((SELECT COUNT(*) FROM Task t WHERE t.projectId=p.id AND t.status='DONE' AND ${missingSignature})) signatureMissing
    FROM Project p WHERE ${scope}`);
  return {
    kind: "projects" as const,
    summary,
    rows: plain(rows),
    total: Number(count[0].total),
    groups: groups.map((g) => ({ label: g.label, count: Number(g.count) })),
  };
}

export function taskSqlScope(
  actor: AuthenticatedUser,
  q: DecisionQuery,
  now: Date,
) {
  const today = calendarDateTime(businessToday(now));
  const person = !q.personId
    ? Prisma.sql`TRUE`
    : q.relation === "PARTICIPATING"
      ? projectPerson(q)
      : q.relation === "HANDLED"
        ? Prisma.sql`EXISTS(SELECT 1 FROM AuditLog a WHERE a.entityType='Task' AND a.entityId=t.id AND a.projectId=t.projectId AND a.actorId=${q.personId} AND ${contribution})`
        : Prisma.sql`t.assigneeId=${q.personId}`;
  const exception =
    q.exception === "OVERDUE"
      ? Prisma.sql`t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND t.dueDate<${today} AND p.status IN ('PLANNING','ACTIVE')`
      : q.exception === "BLOCKED"
        ? Prisma.sql`t.status='BLOCKED'`
        : q.exception === "UNASSIGNED"
          ? Prisma.sql`t.assigneeId IS NULL AND t.status IN ('TODO','IN_PROGRESS','BLOCKED')`
          : q.exception === "UNSCHEDULED"
            ? Prisma.sql`(t.dueDate IS NULL OR t.plannedStartDate IS NULL) AND t.status IN ('TODO','IN_PROGRESS','BLOCKED')`
            : q.exception === "MISSING_DELIVERABLE"
              ? Prisma.sql`t.requiresDeliverable=TRUE AND NOT EXISTS(SELECT 1 FROM Deliverable d JOIN Document doc ON doc.id=d.documentId WHERE d.taskId=t.id AND d.projectId=t.projectId AND d.status='APPROVED' AND doc.storageStatus='AVAILABLE' AND doc.sha256 IS NOT NULL)`
              : Prisma.sql`TRUE`;
  const view =
    q.taskView === "ALL"
      ? Prisma.sql`TRUE`
      : Prisma.sql`t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND ${q.taskView === "CURRENT" ? Prisma.sql`p.status IN ('PLANNING','ACTIVE')` : Prisma.sql`p.status NOT IN ('PLANNING','ACTIVE')`}`;
  return Prisma.sql`${dashboardSqlScope(actor, q.projectId)} AND ${person} AND ${search(Prisma.sql`t.title`, q.q)} AND ${q.status ? Prisma.sql`t.status=${q.status}` : Prisma.sql`t.status<>'CANCELLED'`} AND ${exception}
    AND ${view}
    AND ${q.phase ? Prisma.sql`LOCATE(${`所属阶段：${q.phase}`},COALESCE(t.description,''))>0` : Prisma.sql`TRUE`}
    AND ${q.taskView !== "ALL" ? Prisma.sql`TRUE` : dateScope(q.dateField === "COMPLETED" ? Prisma.sql`t.completedAt` : Prisma.sql`t.createdAt`, q, now, q.dateField === "COMPLETED")}`;
}
export async function personTaskSummary(
  tx: Tx,
  actor: AuthenticatedUser,
  q: DecisionQuery,
  now: Date,
) {
  if (q.dimension !== "tasks" || !q.personId || q.relation !== "RESPONSIBLE")
    return null;
  const scope = taskSqlScope(
    actor,
    { ...q, taskView: "ALL", dateField: "STOCK" },
    now,
  );
  const today = calendarDateTime(businessToday(now));
  const [row] = await tx.$queryRaw<
    {
      current: bigint | null;
      inProgress: bigint | null;
      overdue: bigint | null;
      blocked: bigint | null;
      frozen: bigint | null;
    }[]
  >(Prisma.sql`
    SELECT SUM(p.status IN ('PLANNING','ACTIVE')) current,
      SUM(p.status IN ('PLANNING','ACTIVE') AND t.status='IN_PROGRESS') inProgress,
      SUM(p.status IN ('PLANNING','ACTIVE') AND t.dueDate<${today}) overdue,
      SUM(p.status IN ('PLANNING','ACTIVE') AND t.status='BLOCKED') blocked,
      SUM(p.status NOT IN ('PLANNING','ACTIVE')) frozen
    FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope} AND t.status IN ('TODO','IN_PROGRESS','BLOCKED')`);
  return {
    current: Number(row.current ?? 0),
    inProgress: Number(row.inProgress ?? 0),
    overdue: Number(row.overdue ?? 0),
    blocked: Number(row.blocked ?? 0),
    frozen: Number(row.frozen ?? 0),
  };
}
export async function taskDecision(
  tx: Tx,
  actor: AuthenticatedUser,
  q: DecisionQuery,
  now: Date,
) {
  const scope = taskSqlScope(actor, q, now);
  const dates = decisionDates(q, now);
  const today = calendarDateTime(businessToday(now));
  const order =
    q.taskSort === "FOLLOW_UP"
      ? Prisma.sql`
    CASE WHEN t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE') AND t.dueDate<${today} THEN 0
      WHEN t.status='IN_PROGRESS' THEN 1 WHEN t.status='BLOCKED' THEN 2 WHEN t.status='TODO' THEN 3 ELSE 4 END,
    t.dueDate IS NULL ASC,t.dueDate ASC,t.id ASC`
      : Prisma.sql`t.createdAt DESC,t.id ASC`;
  const [rows, count, states, quality, flow] = await Promise.all([
    tx.$queryRaw<
      Record<string, unknown>[]
    >(Prisma.sql`SELECT t.id,t.projectId,t.title,t.status,p.name projectName,p.status projectStatus,u.name assigneeName,t.dueDate,t.completedAt,t.estimateHours,t.actualHours,
      IF(LOCATE('所属阶段：',COALESCE(t.description,''))>0,TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(t.description,'所属阶段：',-1),'\n',1)),'未分类') phase,
      IF(t.status='DONE' AND t.estimateHours>0 AND t.actualHours>0,t.actualHours-t.estimateHours,NULL) varianceHours,
      IF(t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE') AND t.dueDate<${today},DATEDIFF(${today},t.dueDate),0) overdueDays
      FROM Task t JOIN Project p ON p.id=t.projectId LEFT JOIN User u ON u.id=t.assigneeId WHERE ${scope} ORDER BY ${order} LIMIT ${size} OFFSET ${(q.page - 1) * size}`),
    tx.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) total FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope}`,
    ),
    tx.$queryRaw<{ label: string; count: bigint }[]>(
      Prisma.sql`SELECT t.status label,COUNT(*) count FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope} GROUP BY t.status`,
    ),
    tx.$queryRaw<
      {
        pairs: bigint;
        variance: Prisma.Decimal | null;
        activeOverdue: bigint;
        frozenBacklog: bigint;
        late1: bigint;
        late2: bigint;
        late3: bigint;
        onTime: bigint;
        datedDone: bigint;
      }[]
    >(Prisma.sql`SELECT
      SUM(t.status='DONE' AND t.estimateHours>0 AND t.actualHours>0) pairs,
      SUM(IF(t.status='DONE' AND t.estimateHours>0 AND t.actualHours>0,t.actualHours-t.estimateHours,0)) variance,
      SUM(t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE') AND t.dueDate<${today}) activeOverdue,
      SUM(t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('ON_HOLD','CANCELLED','ARCHIVED','PENDING_ACCEPTANCE')) frozenBacklog,
      SUM(t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE') AND DATEDIFF(${today},t.dueDate) BETWEEN 1 AND 3) late1,
      SUM(t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE') AND DATEDIFF(${today},t.dueDate) BETWEEN 4 AND 7) late2,
      SUM(t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE') AND DATEDIFF(${today},t.dueDate)>7) late3,
      SUM(t.status='DONE' AND t.dueDate IS NOT NULL AND t.completedAt IS NOT NULL) datedDone,
      SUM(t.status='DONE' AND t.dueDate IS NOT NULL AND t.completedAt<=t.dueDate) onTime
      FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope}`),
    tx.task.count({
      where: {
        project: dashboardScope(actor, q.projectId),
        createdAt: { gte: dates.start, lt: dates.end },
        ...(q.personId ? { assigneeId: q.personId } : {}),
      },
    }),
  ]);
  return {
    kind: "tasks" as const,
    rows: plain(rows),
    total: Number(count[0].total),
    groups: states.map((r) => ({ label: r.label, count: Number(r.count) })),
    quality: quality[0],
    createdInPeriod: flow,
  };
}

export async function requirementDecision(
  tx: Tx,
  actor: AuthenticatedUser,
  q: DecisionQuery,
  now: Date,
) {
  const today = calendarDateTime(businessToday(now));
  const dates = decisionDates(q, now);
  const person = !q.personId
    ? Prisma.sql`TRUE`
    : q.relation === "PARTICIPATING"
      ? projectPerson(q)
      : q.relation === "HANDLED"
        ? Prisma.sql`EXISTS(SELECT 1 FROM AuditLog a WHERE a.entityType='Requirement' AND a.entityId=r.id AND a.projectId=r.projectId AND a.actorId=${q.personId} AND ${contribution})`
        : Prisma.sql`r.ownerId=${q.personId}`;
  const scope = Prisma.sql`${dashboardSqlScope(actor, q.projectId)} AND ${person} AND ${search(Prisma.sql`r.title`, q.q)} AND ${q.status ? Prisma.sql`r.workflowState=${q.status}` : Prisma.sql`r.workflowState<>'CANCELLED'`} AND ${q.priority ? Prisma.sql`r.priority=${q.priority}` : Prisma.sql`TRUE`}
    AND ${q.exception === "OVERDUE" ? Prisma.sql`r.managed=TRUE AND r.workflowState NOT IN ('CLOSED','CANCELLED') AND r.dueDate<${today} AND p.status IN ('PLANNING','ACTIVE')` : q.exception === "UNASSIGNED" ? Prisma.sql`r.ownerId IS NULL AND r.managed=TRUE AND r.workflowState NOT IN ('CLOSED','CANCELLED')` : Prisma.sql`TRUE`}
    AND ${dateScope(q.dateField === "COMPLETED" ? Prisma.sql`r.completedAt` : Prisma.sql`r.createdAt`, q, now, q.dateField === "COMPLETED")}`;
  const [rows, count, states, totals, intakes] = await Promise.all([
    tx.$queryRaw<
      Record<string, unknown>[]
    >(Prisma.sql`SELECT r.id,r.projectId,r.title,r.number,r.workflowState status,r.managed,p.name projectName,u.name ownerName,r.priority,r.dueDate,r.completedAt,r.approvedVersion,r.draftVersion,
      (SELECT COUNT(*) FROM Task t WHERE t.projectId=r.projectId AND t.status<>'CANCELLED' AND (t.requirementId=r.id OR EXISTS(SELECT 1 FROM RequirementTaskLink l WHERE l.taskId=t.id AND l.requirementId=r.id AND l.projectId=r.projectId))) linkedTasks
      FROM Requirement r JOIN Project p ON p.id=r.projectId LEFT JOIN User u ON u.id=r.ownerId WHERE ${scope} ORDER BY r.createdAt DESC,r.id ASC LIMIT ${size} OFFSET ${(q.page - 1) * size}`),
    tx.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) total FROM Requirement r JOIN Project p ON p.id=r.projectId WHERE ${scope}`,
    ),
    tx.$queryRaw<{ label: string; count: bigint }[]>(
      Prisma.sql`SELECT IF(r.managed=TRUE,r.workflowState,'LEGACY') label,COUNT(*) count FROM Requirement r JOIN Project p ON p.id=r.projectId WHERE ${scope} GROUP BY IF(r.managed=TRUE,r.workflowState,'LEGACY')`,
    ),
    tx.$queryRaw<
      {
        legacy: bigint;
        overdue: bigint;
        changed: bigint;
        closed: bigint;
        noTasks: bigint;
      }[]
    >(Prisma.sql`SELECT SUM(r.managed=FALSE) legacy,
      SUM(r.managed=TRUE AND r.workflowState NOT IN ('CLOSED','CANCELLED') AND r.dueDate<${today} AND p.status IN ('PLANNING','ACTIVE')) overdue,
      SUM(EXISTS(SELECT 1 FROM RequirementChangeRequest c WHERE c.requirementId=r.id AND c.state IN ('DRAFT','IN_REVIEW'))) changed,
      SUM(r.managed=TRUE AND r.workflowState='CLOSED') closed,
      SUM(r.managed=TRUE AND r.approvedVersion IS NOT NULL AND NOT EXISTS(SELECT 1 FROM Task t WHERE t.status<>'CANCELLED' AND t.projectId=r.projectId AND (t.requirementId=r.id OR EXISTS(SELECT 1 FROM RequirementTaskLink l WHERE l.taskId=t.id AND l.requirementId=r.id)))) noTasks
      FROM Requirement r JOIN Project p ON p.id=r.projectId WHERE ${scope}`),
    tx.requirementIntake.groupBy({
      by: ["state"],
      where: {
        project: dashboardScope(actor, q.projectId),
        createdAt: { gte: dates.start, lt: dates.end },
        ...(q.personId ? { createdById: q.personId } : {}),
      },
      _count: { _all: true },
    }),
  ]);
  return {
    kind: "requirements" as const,
    rows: plain(rows),
    total: Number(count[0].total),
    groups: states.map((r) => ({ label: r.label, count: Number(r.count) })),
    quality: totals[0],
    intakeGroups: intakes.map((i) => ({
      label: i.state,
      count: i._count._all,
    })),
  };
}

export async function peopleDecision(
  tx: Tx,
  actor: AuthenticatedUser,
  q: DecisionQuery,
  now: Date,
) {
  const scope = dashboardSqlScope(actor, q.projectId);
  const today = calendarDateTime(businessToday(now));
  const visible = Prisma.sql`(EXISTS(SELECT 1 FROM Project p WHERE ${scope} AND p.ownerId=u.id) OR EXISTS(SELECT 1 FROM Project p JOIN ProjectMember m ON m.projectId=p.id WHERE ${scope} AND m.userId=u.id AND m.active=TRUE) OR EXISTS(SELECT 1 FROM Project p JOIN Task t ON t.projectId=p.id WHERE ${scope} AND t.assigneeId=u.id) OR EXISTS(SELECT 1 FROM Project p JOIN Requirement r ON r.projectId=p.id WHERE ${scope} AND r.ownerId=u.id) OR EXISTS(SELECT 1 FROM Project p JOIN AuditLog a ON a.projectId=p.id WHERE ${scope} AND a.actorId=u.id AND ${contribution}))`;
  const where = Prisma.sql`u.isSystem=FALSE AND ${actor.role === "PM" || q.projectId ? visible : Prisma.sql`TRUE`} AND ${q.personId ? Prisma.sql`u.id=${q.personId}` : Prisma.sql`TRUE`} AND ${q.role ? Prisma.sql`u.role=${q.role}` : Prisma.sql`TRUE`} AND ${q.status ? Prisma.sql`u.status=${q.status}` : Prisma.sql`TRUE`} AND (${search(Prisma.sql`u.name`, q.q)} OR ${search(Prisma.sql`u.email`, q.q)})`;
  const [rows, count, groups] = await Promise.all([
    tx.$queryRaw<
      Record<string, unknown>[]
    >(Prisma.sql`SELECT u.id,u.name title,u.email,u.role,u.status,
      (SELECT COUNT(*) FROM Project p WHERE ${scope} AND p.ownerId=u.id) ownedProjects,
      (SELECT COUNT(DISTINCT p.id) FROM Project p JOIN ProjectMember m ON m.projectId=p.id WHERE ${scope} AND m.userId=u.id AND m.active=TRUE) participatingProjects,
      (SELECT COUNT(*) FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope} AND t.assigneeId=u.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE')) openTasks,
      (SELECT COUNT(*) FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope} AND t.assigneeId=u.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE') AND t.dueDate<${today}) overdueTasks,
      (SELECT SUM(t.estimateHours) FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope} AND t.assigneeId=u.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE')) openEstimatedHours,
      (SELECT COUNT(*) FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope} AND t.assigneeId=u.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status NOT IN ('PLANNING','ACTIVE')) frozenTasks,
      (SELECT COUNT(*) FROM Requirement r JOIN Project p ON p.id=r.projectId WHERE ${scope} AND r.ownerId=u.id AND r.managed=TRUE AND r.workflowState NOT IN ('CLOSED','CANCELLED') AND p.status IN ('PLANNING','ACTIVE')) openRequirements,
      (SELECT COUNT(*) FROM AuditLog a JOIN Project p ON p.id=a.projectId WHERE ${scope} AND a.actorId=u.id AND ${contribution}) handledEvents
      FROM User u WHERE ${where} ORDER BY u.name ASC,u.id ASC LIMIT ${size} OFFSET ${(q.page - 1) * size}`),
    tx.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) total FROM User u WHERE ${where}`,
    ),
    tx.$queryRaw<{ label: string; count: bigint }[]>(
      Prisma.sql`SELECT u.role label,COUNT(*) count FROM User u WHERE ${where} GROUP BY u.role`,
    ),
  ]);
  const [summary] = await tx.$queryRaw<
    {
      active: bigint;
      loaded: bigint;
      overdue: bigint;
      openTasks: bigint;
      openRequirements: bigint;
    }[]
  >(Prisma.sql`
    SELECT SUM(u.status='ACTIVE') active,
      SUM(EXISTS(SELECT 1 FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope} AND t.assigneeId=u.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE'))) loaded,
      SUM((SELECT COUNT(*) FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope} AND t.assigneeId=u.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE') AND t.dueDate<${today})) overdue,
      SUM((SELECT COUNT(*) FROM Task t JOIN Project p ON p.id=t.projectId WHERE ${scope} AND t.assigneeId=u.id AND t.status IN ('TODO','IN_PROGRESS','BLOCKED') AND p.status IN ('PLANNING','ACTIVE'))) openTasks,
      SUM((SELECT COUNT(*) FROM Requirement r JOIN Project p ON p.id=r.projectId WHERE ${scope} AND r.ownerId=u.id AND r.managed=TRUE AND r.workflowState NOT IN ('CLOSED','CANCELLED') AND p.status IN ('PLANNING','ACTIVE'))) openRequirements
    FROM User u WHERE ${where}`);
  return {
    kind: "people" as const,
    summary,
    rows: plain(rows),
    total: Number(count[0].total),
    groups: groups.map((r) => ({ label: r.label, count: Number(r.count) })),
  };
}

export async function personEvidence(
  tx: Tx,
  actor: AuthenticatedUser,
  q: DecisionQuery,
  now: Date,
) {
  if (!q.personId) return null;
  const visible = await peopleDecision(
    tx,
    actor,
    {
      ...q,
      dimension: "people",
      q: "",
      status: undefined,
      role: undefined,
      page: 1,
    },
    now,
  );
  if (!visible.rows.length) return null;
  const person = visible.rows[0];
  return {
    id: String(person.id),
    name: String(person.title),
    role: String(person.role),
    status: String(person.status),
  };
}
export async function handledEvidence(
  tx: Tx,
  actor: AuthenticatedUser,
  q: DecisionQuery,
  now: Date,
) {
  const dates = decisionDates(q, now);
  return plain(
    await tx.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`SELECT a.id,a.entityId,a.entityType,a.projectId,p.name projectName,a.action title,a.actorRole roleAtEvent,a.createdAt FROM AuditLog a JOIN Project p ON p.id=a.projectId WHERE ${dashboardSqlScope(actor, q.projectId)} AND a.actorId=${q.personId} AND ${contribution} AND a.createdAt>=${dates.start} AND a.createdAt<${dates.end} ORDER BY a.createdAt DESC,a.id DESC LIMIT 20`,
    ),
  );
}
export async function observationRows(
  tx: Tx,
  actor: AuthenticatedUser,
  q: DecisionQuery,
  now: Date,
) {
  const dates = decisionDates(q, now);
  const rows = await tx.decisionSnapshot.groupBy({
    by: ["day"],
    where: {
      project: dashboardScope(actor, q.projectId),
      day: {
        gte: new Date(`${dates.from}T00:00:00.000Z`),
        lt: new Date(
          new Date(`${dates.to}T00:00:00.000Z`).getTime() + 86400000,
        ),
      },
    },
    _sum: {
      taskTotal: true,
      taskDone: true,
      overdueTasks: true,
      openRequirements: true,
    },
    orderBy: { day: "desc" },
    take: 92,
  });
  return rows.map((row) => ({
    day: row.day.toISOString().slice(0, 10),
    taskTotal: row._sum.taskTotal ?? 0,
    taskDone: row._sum.taskDone ?? 0,
    overdueTasks: row._sum.overdueTasks ?? 0,
    openRequirements: row._sum.openRequirements ?? 0,
  }));
}
export function operationalTaskWhere(
  actor: AuthenticatedUser,
  projectId?: string,
): Prisma.TaskWhereInput {
  return {
    project: {
      AND: [
        dashboardScope(actor, projectId),
        { status: { in: [...liveStatuses] } },
      ],
    },
    status: { in: openTask },
  };
}
