import { projectScoped } from "@/modules/auth/project-scope-http";
import { complianceHttp, parseId, parseJson } from "@/modules/ai/compliance-audit/http";
import { findingReviewSchema, reviewFinding } from "@/modules/ai/compliance-audit/review-service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { ProjectError } from "@/modules/projects/services";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function POSTHandler(request: Request, context: { params: Promise<{ suggestionId: string; findingKey: string }> }) {
  return complianceHttp(["QA"], async (actor) => {
    const { suggestionId, findingKey } = await context.params;
    if (!/^[A-Z_]+:[0-9a-f-]{36}:\d+$/.test(findingKey) || findingKey.length > 191) throw new ProjectError("问题标识无效", 400);
    return Response.json({ data: await reviewFinding(parseId(suggestionId), findingKey, await parseJson(request, findingReviewSchema), { actorId: actor.id, ...getAuditRequestMetadata(request) }) }, { status: 201 });
  });
}

export const POST = projectScoped(POSTHandler);
