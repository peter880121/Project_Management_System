import { z } from "zod";
import { assetHttp } from "@/modules/assets/http";
import { createDeliverable, listDeliverables } from "@/modules/assets/services";
import { deliverableCreateSchema, roles } from "@/modules/assets/validation";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, [...roles], async () => {
    const query = z.object({ taskId: z.uuid().optional(), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ data: await listDeliverables(projectId, query.taskId, query.page) });
  });
}
export async function POST(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, ["PM"], async user => Response.json({ data: await createDeliverable(projectId, deliverableCreateSchema.parse(await request.json()), { actorId: user.id, ...getAuditRequestMetadata(request) }) }, { status: 201 }), request);
}
