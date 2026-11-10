import { z } from "zod";
import { complianceHttp } from "@/modules/ai/compliance-audit/http";
import { listIssues, issueScope } from "@/modules/audit/issue-repositories";
import { issueStates } from "@/modules/audit/issue-schema";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
const querySchema = z
  .object({
    projectId: z.uuid().optional(),
    status: z.enum(issueStates).optional(),
    cursor: z.uuid().optional(),
    overdue: z.literal("true").optional(),
  })
  .strict();
export function GET(request: Request) {
  return complianceHttp(["ADMIN", "QA", "PM", "MEMBER"], async (actor) => {
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return Response.json({ error: "筛选条件无效" }, { status: 400 });
    const q = parsed.data;
    const [rows, counts, overdue] = await Promise.all([
      listIssues(actor, q.projectId, q.status, q.cursor, q.overdue === "true"),
      prisma.auditIssue.groupBy({
        by: ["status"],
        where: issueScope(actor, q.projectId),
        _count: true,
      }),
      prisma.auditIssue.count({
        where: {
          ...issueScope(actor, q.projectId),
          status: { in: ["OPEN", "REMEDIATING", "VERIFYING"] },
          dueDate: { lt: new Date() },
        },
      }),
    ]);
    return Response.json({
      data: rows.slice(0, 30),
      nextCursor: rows.length > 30 ? rows[29].id : null,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      overdue,
    });
  });
}
