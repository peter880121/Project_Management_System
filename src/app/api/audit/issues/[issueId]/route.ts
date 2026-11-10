import { complianceHttp, parseId, parseJson } from "@/modules/ai/compliance-audit/http";
import { findIssue } from "@/modules/audit/issue-repositories";
import { changeIssue } from "@/modules/audit/issue-service";
import { issueCommandSchema } from "@/modules/audit/issue-schema";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { prisma } from "@/lib/prisma";
import { canReadDocument, meetingAttachmentSelect } from "@/modules/documents/access";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ issueId: string }> };
export function GET(_request: Request, context: Context) {
  return complianceHttp(["ADMIN", "QA", "PM", "MEMBER"], async actor => {
    const data = await findIssue(actor, parseId((await context.params).issueId));
    if (!data) return Response.json({ error: "问题不存在或不可访问" }, { status: 404 });
    const [members, documents] = await Promise.all([
      prisma.user.findMany({ where: { status: "ACTIVE", isSystem: false, role: { in: ["PM", "MEMBER"] }, OR: [{ ownedProjects: { some: { id: data.projectId } } }, { projectMemberships: { some: { projectId: data.projectId, active: true } } }] }, select: { id: true, name: true } }),
      prisma.document.findMany({ where: { projectId: data.projectId, storageStatus: "AVAILABLE" }, select: { id: true, filename: true, projectId: true, visibleRoles: true, meetingAttachment: { select: meetingAttachmentSelect } }, orderBy: { createdAt: "desc" } }),
    ]);
    return Response.json({ data, members, documents: documents.filter(d => canReadDocument(d, actor.role) && canReadDocument(d, "QA")).map(d => ({ id: d.id, filename: d.filename })) });
  });
}
export function PATCH(request: Request, context: Context) {
  return complianceHttp(["QA", "PM", "MEMBER"], async actor => Response.json({ data: await changeIssue(parseId((await context.params).issueId), await parseJson(request, issueCommandSchema), { actorId: actor.id, ...getAuditRequestMetadata(request) }) }));
}
