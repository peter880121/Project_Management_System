import { projectScoped } from "@/modules/auth/project-scope-http";
import { complianceHttp, parseId, parseJson } from "@/modules/ai/compliance-audit/http";
import { summaryDetail } from "@/modules/ai/compliance-audit/repositories";
import { decisionSchema, reviewSummary } from "@/modules/ai/compliance-audit/review-service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { ProjectError } from "@/modules/projects/services";
type Context = { params: Promise<{ suggestionId: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function GETHandler(_request: Request, context: Context) {
  return complianceHttp(["ADMIN", "QA"], async () => {
    const data = await summaryDetail(parseId((await context.params).suggestionId));
    if (!data) throw new ProjectError("摘要不存在", 404);
    return Response.json({ data });
  });
}
function PATCHHandler(request: Request, context: Context) {
  return complianceHttp(["QA"], async (actor) => Response.json({ data: await reviewSummary(parseId((await context.params).suggestionId), await parseJson(request, decisionSchema), { actorId: actor.id, ...getAuditRequestMetadata(request) }) }));
}

export const GET = projectScoped(GETHandler);
export const PATCH = projectScoped(PATCHHandler);
