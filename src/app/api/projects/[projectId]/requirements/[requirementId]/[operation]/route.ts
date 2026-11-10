import { z } from "zod";
import { assetHttp } from "@/modules/assets/http";
import { actOnRequirement } from "@/modules/requirements/services";
import { operations } from "@/modules/requirements/schemas";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
type Context = { params: Promise<{ projectId: string; requirementId: string; operation: string }> };
export const runtime = "nodejs";
export async function POST(request: Request, { params }: Context) {
  const { projectId, requirementId, operation } = await params;
  return assetHttp(projectId, ["PM", "ADMIN", "QA", "MEMBER"], async user => {
    z.uuid().parse(requirementId); const action = z.enum(operations).parse(operation);
    return Response.json({ data: await actOnRequirement(projectId, requirementId, action, await request.json(), { actorId: user.id, ...getAuditRequestMetadata(request) }) });
  }, request);
}
