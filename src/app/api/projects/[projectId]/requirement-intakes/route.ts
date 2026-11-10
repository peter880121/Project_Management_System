import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assetHttp } from "@/modules/assets/http";
import { createIntake } from "@/modules/requirements/services";
import { attachmentSelect } from "@/modules/requirements/repositories";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
type Context = { params: Promise<{ projectId: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN", "QA", "MEMBER", "PMO"], async () => {
    const page = z.coerce.number().int().min(1).max(10000).parse(new URL(request.url).searchParams.get("page") ?? 1);
    const [rows, total] = await prisma.$transaction([prisma.requirementIntake.findMany({ where: { projectId }, include: { attachments: { select: attachmentSelect } }, take: 20, skip: (page - 1) * 20, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }), prisma.requirementIntake.count({ where: { projectId } })]);
    return Response.json({ data: { rows, total, page, pages: Math.max(1, Math.ceil(total / 20)) } });
  });
}
export async function POST(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN", "QA", "MEMBER"], async user => Response.json({ data: await createIntake(projectId, await request.json(), { actorId: user.id, ...getAuditRequestMetadata(request) }) }, { status: 201 }), request);
}
