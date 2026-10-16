import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { planningHttp } from "@/modules/planning/http";
import { readRiskNotification } from "@/modules/ai/risk/notifications";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
async function POSTHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  return planningHttp(["PM"], async (actor) => {
    const { id } = await context.params; if (!z.uuid().safeParse(id).success) return Response.json({ error: "通知 ID 无效" }, { status: 400 });
    return Response.json({ data: await readRiskNotification(id, { actorId: actor.id, ...getAuditRequestMetadata(request) }) });
  });
}

export const POST = projectScoped(POSTHandler);
