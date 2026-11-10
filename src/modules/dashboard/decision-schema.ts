import { z } from "zod";
import { dateSchema, hkToday } from "@/modules/weekly-reports/policy";
export const decisionQuerySchema = z
  .object({
    dimension: z
      .enum(["projects", "tasks", "requirements", "people"])
      .default("projects"),
    projectId: z.uuid().optional(),
    personId: z.uuid().optional(),
    role: z.enum(["ADMIN", "PMO", "PM", "QA", "MEMBER"]).optional(),
    relation: z
      .enum(["RESPONSIBLE", "PARTICIPATING", "HANDLED"])
      .default("RESPONSIBLE"),
    taskView: z.enum(["CURRENT", "FROZEN", "ALL"]).optional(),
    taskSort: z.enum(["FOLLOW_UP", "NEWEST"]).optional(),
    dateField: z.enum(["STOCK", "CREATED", "COMPLETED"]).default("STOCK"),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    status: z.string().trim().max(32).optional(),
    phase: z.string().trim().max(50).optional(),
    priority: z.enum(["MUST", "SHOULD", "COULD", "LATER"]).optional(),
    exception: z
      .enum([
        "ALL",
        "OVERDUE",
        "BLOCKED",
        "UNASSIGNED",
        "UNSCHEDULED",
        "MISSING_DELIVERABLE",
      ])
      .default("ALL"),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.from > v.to)
      ctx.addIssue({ code: "custom", message: "起始日期不能晚于结束日期" });
    const statuses =
      v.dimension === "tasks"
        ? ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]
        : v.dimension === "projects"
          ? [
              "PLANNING",
              "ACTIVE",
              "ON_HOLD",
              "PENDING_ACCEPTANCE",
              "ARCHIVED",
              "CANCELLED",
              "COMPLETED",
            ]
          : v.dimension === "requirements"
            ? [
                "DRAFT",
                "IN_REVIEW",
                "APPROVED",
                "IMPLEMENTING",
                "VERIFYING",
                "CUSTOMER_CONFIRMATION",
                "CLOSED",
                "CANCEL_REVIEW",
                "CANCELLED",
              ]
            : ["ACTIVE", "DISABLED", "PENDING"];
    if (v.status && !statuses.includes(v.status))
      ctx.addIssue({ code: "custom", message: "状态不属于当前维度" });
  })
  .transform((q) => ({
    ...q,
    taskView:
      q.taskView ??
      (q.dimension === "tasks" && q.personId && q.relation === "RESPONSIBLE"
        ? "CURRENT"
        : "ALL"),
    taskSort:
      q.taskSort ??
      (q.dimension === "tasks" && q.personId && q.relation === "RESPONSIBLE"
        ? "FOLLOW_UP"
        : "NEWEST"),
  }));
export type DecisionQuery = z.infer<typeof decisionQuerySchema>;
export function decisionDates(
  q: Pick<DecisionQuery, "from" | "to">,
  now = new Date(),
) {
  const to = q.to ?? hkToday(now);
  const from = q.from ?? hkToday(new Date(now.getTime() - 29 * 86400000));
  return {
    from,
    to,
    start: new Date(new Date(`${from}T00:00:00.000Z`).getTime() - 8 * 3600000),
    end: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 16 * 3600000),
  };
}
export type DecisionCell = string | number | null;
export type DecisionRow = Record<string, DecisionCell>;
export type DecisionData = {
  dimension: DecisionQuery["dimension"];
  generatedAt: string;
  scope: string;
  metrics: { label: string; value: number | null; detail: string }[];
  groups: { label: string; count: number }[];
  rows: DecisionRow[];
  total: number;
  page: number;
  projects: { id: string; name: string }[];
  person: { id: string; name: string; role: string; status: string } | null;
  personTasks: {
    current: number;
    inProgress: number;
    overdue: number;
    blocked: number;
    frozen: number;
  } | null;
  observations: {
    day: string;
    taskTotal: number;
    taskDone: number;
    overdueTasks: number;
    openRequirements: number;
  }[];
  notes: string[];
};
