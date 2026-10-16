import { z } from "zod";
import { planningHttp } from "@/modules/planning/http";
import { capacitySchema } from "@/modules/planning/schemas";
import { updateMemberCapacity } from "@/modules/planning/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return planningHttp(["PM"], async (actor) => {
    const { id } = await context.params; const body = capacitySchema.safeParse(await request.json().catch(() => null));
    if (!z.uuid().safeParse(id).success || !body.success) return Response.json({ error: "容量参数无效", issues: body.success ? [] : body.error.issues }, { status: 400 });
    return Response.json({ data: await updateMemberCapacity(id, body.data, { actorId: actor.id, ...getAuditRequestMetadata(request) }) });
  });
}
