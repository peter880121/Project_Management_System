import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lockBusinessActor } from "@/modules/auth/project-access";
import {
  recordAudit,
  type AuditRequestMetadata,
} from "@/modules/audit/service";
import { ProjectError } from "@/modules/projects/services";
import { dateSchema, hkToday, weekWindow } from "./policy";
import { initializePeriod } from "./repositories";

export const statisticsSchema = z
  .object({
    week: dateSchema.default(hkToday),
    projectId: z.uuid().optional(),
    authorId: z.uuid().optional(),
    role: z.enum(["ADMIN", "PMO", "PM", "QA", "MEMBER"]).optional(),
  })
  .strict();
export async function weeklyStatistics(raw: unknown, actorId: string) {
  const input = statisticsSchema.parse(raw);
  const window = weekWindow(input.week);
  return prisma.$transaction(async (tx) => {
    const user = await lockBusinessActor(tx, actorId, ["ADMIN", "PMO", "PM"]);
    await initializePeriod(tx, hkToday());
    const global = user.role !== "PM" && !input.projectId;
    const scope = Prisma.sql`${input.projectId ? Prisma.sql`s.projectId=${input.projectId}` : Prisma.sql`TRUE`} AND ${user.role === "PM" ? Prisma.sql`EXISTS(SELECT 1 FROM Project p WHERE p.id=s.projectId AND p.ownerId=${actorId})` : Prisma.sql`TRUE`}`;
    const [summary] = await tx.$queryRaw<
      {
        people: bigint;
        sections: bigint;
        hours: Prisma.Decimal | null;
        risks: bigint;
        pending: bigint;
      }[]
    >(Prisma.sql`
      SELECT COUNT(DISTINCT r.authorId) people, COUNT(DISTINCT CONCAT(v.id,s.sectionId)) sections,
        COALESCE(SUM(i.hours),0) hours, SUM(IF(i.kind='RISK',1,0)) risks,
        COUNT(DISTINCT IF(COALESCE((SELECT review.decision FROM WeeklyReportReview review JOIN WeeklyReportRevision rv ON rv.id=review.revisionId WHERE rv.reportId=r.id AND review.sectionId=s.sectionId AND review.sectionSha256=JSON_UNQUOTE(JSON_EXTRACT(v.snapshot,CONCAT('$.sectionHashes."',s.sectionId,'"'))) ORDER BY review.createdAt DESC,review.id DESC LIMIT 1),'PENDING') <> 'READ',CONCAT(v.id,s.sectionId),NULL)) pending
      FROM WeeklyReport r JOIN WeeklyReportRevision v ON v.reportId=r.id AND v.version=(SELECT MAX(v2.version) FROM WeeklyReportRevision v2 WHERE v2.reportId=r.id)
      JOIN JSON_TABLE(v.snapshot,'$.sections[*]' COLUMNS(sectionId CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.id', projectId CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.projectId' NULL ON EMPTY, content JSON PATH '$.items')) s ON TRUE
      LEFT JOIN JSON_TABLE(s.content,'$[*]' COLUMNS(hours DECIMAL(6,2) PATH '$.declaredHours' NULL ON EMPTY,kind VARCHAR(20) PATH '$.kind')) i ON TRUE
      WHERE r.weekStart=${window.start} AND ${scope} AND ${input.authorId ? Prisma.sql`r.authorId=${input.authorId}` : Prisma.sql`TRUE`} AND ${input.role ? Prisma.sql`JSON_UNQUOTE(JSON_EXTRACT(v.snapshot,'$.authorRole'))=${input.role}` : Prisma.sql`TRUE`}`);
    const period = await tx.weeklyReportPeriod.findUnique({
      where: { weekStart: window.start },
    });
    const [compliance] =
      global && period
        ? await tx.$queryRaw<
            {
              required: bigint;
              submitted: bigint;
              onTime: bigint;
              late: bigint;
            }[]
          >(Prisma.sql`
      SELECT COUNT(*) required,SUM(IF(first.submittedAt IS NOT NULL,1,0)) submitted,
        SUM(IF(first.submittedAt<=e.deadline,1,0)) onTime,SUM(IF(first.submittedAt>e.deadline,1,0)) late
      FROM WeeklyReportExpectation e LEFT JOIN WeeklyReport r ON r.authorId=e.authorId AND r.weekStart=e.weekStart
      LEFT JOIN (SELECT reportId,MIN(submittedAt) submittedAt FROM WeeklyReportRevision GROUP BY reportId) first ON first.reportId=r.id
      WHERE e.weekStart=${window.start} AND e.exemptReason IS NULL AND ${input.authorId ? Prisma.sql`e.authorId=${input.authorId}` : Prisma.sql`TRUE`} AND ${input.role ? Prisma.sql`e.role=${input.role}` : Prisma.sql`TRUE`}`)
        : [];
    return {
      week: window.label,
      rosterCaptured: Boolean(period),
      scope: global ? "GLOBAL" : "PROJECT_SECTIONS",
      reportedPeople: Number(summary.people),
      sections: Number(summary.sections),
      declaredHours: Number(summary.hours),
      riskItems: Number(summary.risks ?? 0),
      pendingSections: Number(summary.pending),
      required: compliance ? Number(compliance.required) : null,
      submitted: compliance ? Number(compliance.submitted ?? 0) : null,
      missing: compliance
        ? Number(compliance.required) - Number(compliance.submitted ?? 0)
        : null,
      onTime: compliance ? Number(compliance.onTime ?? 0) : null,
      late: compliance ? Number(compliance.late ?? 0) : null,
    };
  });
}
export async function exemptWeekly(
  raw: unknown,
  actor: { actorId: string } & AuditRequestMetadata,
) {
  const input = z
    .object({
      authorId: z.uuid(),
      week: dateSchema,
      reason: z.string().trim().min(5).max(500),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, actor.actorId, ["ADMIN", "PMO"]);
    const old = await tx.weeklyReportExpectation.findUnique({
      where: {
        authorId_weekStart: {
          authorId: input.authorId,
          weekStart: weekWindow(input.week).start,
        },
      },
    });
    if (!old)
      throw new ProjectError("该周未采集应报人员，不能补造历史分母", 400);
    const row = await tx.weeklyReportExpectation.update({
      where: { id: old.id },
      data: { exemptReason: input.reason },
    });
    await recordAudit(tx, {
      ...actor,
      action: "WEEKLY_REPORT_EXEMPTED",
      entityType: "WeeklyReportExpectation",
      entityId: row.id,
      before: { exemptReason: old.exemptReason },
      after: {
        exemptReason: input.reason,
        authorId: input.authorId,
        week: input.week,
      },
    });
    return { id: row.id, exemptReason: row.exemptReason };
  });
}
