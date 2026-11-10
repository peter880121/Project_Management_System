import { createHash } from "node:crypto";
import { z } from "zod";

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "日期无效");
export function weekWindow(value: string) {
  dateSchema.parse(value);
  const day = new Date(`${value}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const start = new Date(day.getTime() - 8 * 3600000);
  const end = new Date(start.getTime() + 7 * 86400000);
  return {
    label: day.toISOString().slice(0, 10),
    start,
    end,
    deadline: new Date(end.getTime() + deadlineHour() * 3600000),
  };
}
function deadlineHour() {
  const hour = Number(process.env.WEEKLY_REPORT_DEADLINE_HOUR_HK ?? "12");
  if (!Number.isInteger(hour) || hour < 0 || hour > 23)
    throw new Error("Invalid weekly report deadline hour");
  return hour;
}
export const hkToday = (now = new Date()) =>
  new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
// MySQL normalizes JSON key ordering. Hash canonical data, never insertion order.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const itemSchema = z
  .object({
    kind: z.enum(["COMPLETED", "ONGOING", "RISK", "NEXT_WEEK"]),
    text: z.string().trim().min(1).max(2000),
    sourceType: z
      .enum(["TASK", "REQUIREMENT", "DELIVERABLE", "MEETING", "AUDIT"])
      .nullable()
      .default(null),
    sourceId: z.uuid().nullable().default(null),
    targetDate: dateSchema.nullable().default(null),
    declaredHours: z
      .number()
      .finite()
      .min(0)
      .max(168)
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
        "工时最多两位小数",
      )
      .nullable()
      .default(null),
  })
  .strict()
  .refine(
    (v) => Boolean(v.sourceId) === Boolean(v.sourceType),
    "来源类型与 ID 必须同时填写",
  );
export const sectionSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid().nullable(),
    summary: z.string().trim().max(5000),
    items: z.array(itemSchema).max(100),
  })
  .strict();
export const saveSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    sections: z.array(sectionSchema).min(1).max(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    const projects = new Set<string>();
    const sources = new Set<string>();
    let hours = 0;
    for (const section of value.sections) {
      const project = section.projectId ?? "personal";
      if (ids.has(section.id) || projects.has(project))
        ctx.addIssue({ code: "custom", message: "项目分区重复" });
      ids.add(section.id);
      projects.add(project);
      for (const item of section.items) {
        hours += Math.round((item.declaredHours ?? 0) * 100);
        if (!item.sourceId) continue;
        const key = `${item.sourceType}:${item.sourceId}`;
        if (sources.has(key))
          ctx.addIssue({ code: "custom", message: "同一来源不可重复汇总" });
        sources.add(key);
      }
    }
    if (hours > 16800)
      ctx.addIssue({
        code: "custom",
        message: "每周申报工时合计不能超过 168 小时",
      });
  });
export const reviewSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    sectionId: z.uuid(),
    decision: z.enum(["READ", "RETURNED"]),
    reason: z.string().trim().max(1000),
  })
  .strict()
  .refine(
    (v) => v.decision !== "RETURNED" || v.reason.length >= 5,
    "退回说明至少 5 个字",
  );
export const versionSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export type SectionInput = z.infer<typeof sectionSchema>;
export type SnapshotSection = SectionInput & { projectName: string };
export type ReportSnapshot = {
  sections: SnapshotSection[];
  sectionHashes: Record<string, string>;
  authorRole: string;
  authorName: string;
  weekStart: string;
};
export function visibleSections<T extends { projectId: string | null }>(
  sections: T[],
  own: boolean,
  global: boolean,
  ownedProjects: Set<string>,
) {
  return sections.filter(
    (s) =>
      own || global || Boolean(s.projectId && ownedProjects.has(s.projectId)),
  );
}
