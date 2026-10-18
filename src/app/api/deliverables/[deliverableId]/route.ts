import { prisma } from "@/lib/prisma";
import { assetResourceHttp } from "@/modules/assets/resource-http";
import { evidenceSelect, mutateDeliverable } from "@/modules/assets/services";
import { deliverableEditSchema, roles } from "@/modules/assets/validation";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ deliverableId: string }> };
export async function GET(_request: Request, { params }: Context) {
  const { deliverableId } = await params;
  return assetResourceHttp("deliverable", deliverableId, [...roles], async () => Response.json({ data: await prisma.deliverable.findUnique({ where: { id: deliverableId }, include: { document: { select: evidenceSelect } } }) }));
}
export async function PATCH(request: Request, { params }: Context) {
  const { deliverableId } = await params;
  return assetResourceHttp("deliverable", deliverableId, ["PM"], async user => Response.json({ data: await mutateDeliverable(deliverableId, "edit", deliverableEditSchema.parse(await request.json()), { actorId: user.id, ...getAuditRequestMetadata(request) }) }));
}
