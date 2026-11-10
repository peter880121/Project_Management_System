import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assetHttp } from "@/modules/assets/http";
import { canReadRoles, roles, AssetError } from "@/modules/assets/validation";
import { uploadDocument } from "@/modules/documents/services";
import { readUpload } from "@/modules/documents/validation";
import { documentHttp } from "@/modules/documents/http";
import { publicDocumentSelect } from "@/modules/documents/repositories";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
type Context = { params: Promise<{ projectId: string; meetingId: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: Context) {
  const { projectId, meetingId } = await params;
  return assetHttp(projectId, [...roles], async user => {
    z.uuid().parse(meetingId);
    const row = await prisma.meetingRecord.findFirst({ where: { id: meetingId, projectId } });
    if (!row || !canReadRoles(row.visibleRoles, user.role) || row.status === "DRAFT" && !["PM", "ADMIN"].includes(user.role)) throw new AssetError("无权查看此会议附件", 403);
    const page = z.coerce.number().int().min(1).max(10000).parse(new URL(request.url).searchParams.get("page") ?? 1);
    return Response.json({ data: await prisma.document.findMany({ where: { projectId, meetingAttachmentId: meetingId }, select: publicDocumentSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 20, skip: (page - 1) * 20 }) });
  });
}
export async function POST(request: Request, { params }: Context) {
  const { projectId, meetingId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN"], async user => {
    z.uuid().parse(meetingId);
    return documentHttp(["PM", "ADMIN"], async () => Response.json({ data: await uploadDocument(projectId, { ...await readUpload(request), meetingId }, { actorId: user.id, ...getAuditRequestMetadata(request) }) }, { status: 201 }));
  }, request);
}
