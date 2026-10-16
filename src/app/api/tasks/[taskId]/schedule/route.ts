import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { planningHttp } from "@/modules/planning/http";
import { scheduleSchema } from "@/modules/planning/schemas";
import { updateTaskSchedule } from "@/modules/planning/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const runtime = "nodejs";
async function PATCHHandler(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return planningHttp(["PM"], async (actor) => {
    const { taskId } = await context.params; const body = scheduleSchema.safeParse(await request.json().catch(() => null));
    if (!z.uuid().safeParse(taskId).success || !body.success) return Response.json({ error: "排期参数无效", issues: body.success ? [] : body.error.issues }, { status: 400 });
    return Response.json({ data: await updateTaskSchedule(taskId, body.data, { actorId: actor.id, ...getAuditRequestMetadata(request) }) });
  });
}

export const PATCH = projectScoped(PATCHHandler);
