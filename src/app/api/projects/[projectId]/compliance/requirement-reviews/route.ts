import { projectScoped } from "@/modules/auth/project-scope-http";
import { complianceHttp, parseId, parseJson } from "@/modules/ai/compliance-audit/http";
import { versionReviewSchema, reviewRequirementVersion } from "@/modules/ai/compliance-audit/review-service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function POSTHandler(request: Request, context: { params: Promise<{ projectId: string }> }) {
  return complianceHttp(["QA"], async (actor) => Response.json({ data: await reviewRequirementVersion(parseId((await context.params).projectId), await parseJson(request, versionReviewSchema), { actorId: actor.id, ...getAuditRequestMetadata(request) }) }));
}

export const POST = projectScoped(POSTHandler);
