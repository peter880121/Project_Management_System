import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { planningHttp } from "@/modules/planning/http";
import { retryRiskJob } from "@/modules/ai/risk/scheduler-service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const runtime = "nodejs";
async function POSTHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  return planningHttp(["PM"], async (actor) => {
    const { id } = await context.params; if (!z.uuid().safeParse(id).success) return Response.json({ error: "任务 ID 无效" }, { status: 400 });
    return Response.json({ data: await retryRiskJob(id, { actorId: actor.id, ...getAuditRequestMetadata(request) }) }, { status: 202 });
  });
}

export const POST = projectScoped(POSTHandler);
