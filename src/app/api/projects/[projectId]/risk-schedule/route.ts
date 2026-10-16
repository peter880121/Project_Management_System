import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { planningHttp } from "@/modules/planning/http";
import { configureRiskSchedule, getRiskSchedule, riskScheduleSchema } from "@/modules/ai/risk/scheduler-service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string }> };
async function GETHandler(_request: Request, context: Context) {
  return planningHttp(["PM"], async () => {
    const { projectId } = await context.params; if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "项目 ID 无效" }, { status: 400 });
    return Response.json({ data: await getRiskSchedule(projectId) }, { headers: { "Cache-Control": "no-store" } });
  });
}
async function PUTHandler(request: Request, context: Context) {
  return planningHttp(["PM"], async (actor) => {
    const { projectId } = await context.params; const body = riskScheduleSchema.safeParse(await request.json().catch(() => null));
    if (!z.uuid().safeParse(projectId).success || !body.success) return Response.json({ error: "扫描计划参数无效" }, { status: 400 });
    return Response.json({ data: await configureRiskSchedule(projectId, body.data, { actorId: actor.id, ...getAuditRequestMetadata(request) }) });
  });
}

export const GET = projectScoped(GETHandler);
export const PUT = projectScoped(PUTHandler);
