import { z } from "zod";
import { assetHttp } from "@/modules/assets/http";
import { loadRequirement } from "@/modules/requirements/repositories";
import { editRequirement } from "@/modules/requirements/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
type Context = { params: Promise<{ projectId: string; requirementId: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: Context) {
  const { projectId, requirementId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN", "QA", "MEMBER", "PMO"], async () => {
    z.uuid().parse(requirementId); const data = await loadRequirement(projectId, requirementId);
    return data ? Response.json({ data }) : Response.json({ error: "需求不存在" }, { status: 404 });
  });
}
export async function PATCH(request: Request, { params }: Context) {
  const { projectId, requirementId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN"], async user => { z.uuid().parse(requirementId); return Response.json({ data: await editRequirement(projectId, requirementId, await request.json(), { actorId: user.id, ...getAuditRequestMetadata(request) }) }); }, request);
}
