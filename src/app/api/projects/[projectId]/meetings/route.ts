import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assetHttp } from "@/modules/assets/http";
import { createMeeting, assetIndexStatus } from "@/modules/assets/services";
import { meetingSchema, roles } from "@/modules/assets/validation";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, [...roles], async user => {
    const page = z.coerce.number().int().min(1).max(10000).parse(new URL(request.url).searchParams.get("page") ?? 1);
    const visibility: Prisma.MeetingRecordWhereInput = user.role === "ADMIN" ? {} : { visibleRoles: { array_contains: user.role } };
    const rows = await prisma.meetingRecord.findMany({ where: { projectId, ...visibility }, orderBy: [{ meetingDate: "desc" }, { id: "asc" }], take: 30, skip: (page - 1) * 30 });
    return Response.json({ data: await Promise.all(rows.map(async row => ({ ...row, indexStatus: await assetIndexStatus(row.documentId) }))) });
  });
}
export async function POST(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, ["PM"], async user => Response.json({ data: await createMeeting(projectId, meetingSchema.parse(await request.json()), { actorId: user.id, ...getAuditRequestMetadata(request) }) }, { status: 201 }), request);
}
