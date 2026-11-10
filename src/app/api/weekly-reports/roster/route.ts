import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lockBusinessActor } from "@/modules/auth/project-access";
import { weeklyHttp } from "@/modules/weekly-reports/http";
import { dateSchema, weekWindow } from "@/modules/weekly-reports/policy";
export const GET = (request: Request) =>
  weeklyHttp(request, async (actor) => {
    const input = z
      .object({
        week: dateSchema,
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(
      await prisma.$transaction(async (tx) => {
        await lockBusinessActor(tx, actor.actorId, ["ADMIN", "PMO"]);
        const where = { weekStart: weekWindow(input.week).start };
        const rows = await tx.weeklyReportExpectation.findMany({
          where,
          select: {
            authorId: true,
            role: true,
            deadline: true,
            exemptReason: true,
            author: { select: { name: true, email: true } },
          },
          orderBy: { authorId: "asc" },
          take: 20,
          skip: (input.page - 1) * 20,
        });
        const submitted = await tx.weeklyReport.findMany({
          where: {
            weekStart: where.weekStart,
            authorId: { in: rows.map((r) => r.authorId) },
            revisions: { some: {} },
          },
          select: {
            authorId: true,
            state: true,
            revisions: {
              select: { submittedAt: true },
              orderBy: { version: "asc" },
              take: 1,
            },
          },
        });
        return {
          total: await tx.weeklyReportExpectation.count({ where }),
          rows: rows.map((row) => ({
            ...row,
            submittedAt:
              submitted.find((r) => r.authorId === row.authorId)?.revisions[0]
                ?.submittedAt ?? null,
            state:
              submitted.find((r) => r.authorId === row.authorId)?.state ??
              "MISSING",
          })),
        };
      }),
    );
  });
