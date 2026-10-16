import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { planningHttp } from "@/modules/planning/http";
import { scheduleSchema } from "@/modules/planning/schemas";
import { updateTaskSchedule } from "@/modules/planning/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { scheduleValidationMessage } from "@/modules/planning/form-input";
export const runtime = "nodejs";
async function PATCHHandler(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return planningHttp(["PM"], async (actor) => {
    const { taskId } = await context.params; const input: unknown = await request.json().catch(() => null); const body = scheduleSchema.safeParse(input);
    if (!z.uuid().safeParse(taskId).success || !body.success) return Response.json({ error: !z.uuid().safeParse(taskId).success ? "任务标识无效，请刷新后重试" : scheduleValidationMessage(input) ?? "排期参数无效", issues: body.success ? [] : body.error.issues }, { status: 400 });
    return Response.json({ data: await updateTaskSchedule(taskId, body.data, { actorId: actor.id, ...getAuditRequestMetadata(request) }) });
  });
}

export const PATCH = projectScoped(PATCHHandler);
