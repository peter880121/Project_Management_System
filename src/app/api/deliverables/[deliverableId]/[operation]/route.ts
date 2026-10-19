import { prisma } from "@/lib/prisma";
import { assetResourceHttp } from "@/modules/assets/resource-http";
import { createDeliverable, mutateDeliverable, queueAssetParse, lockAssetActor } from "@/modules/assets/services";
import { deliverableCreateSchema, submitSchema, reviewSchema, syncSchema, AssetError } from "@/modules/assets/validation";
import { recordAudit } from "@/modules/audit/service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ deliverableId: string; operation: string }> }) {
  const { deliverableId: id, operation } = await params;
  if (!["versions", "submit", "review", "index"].includes(operation)) return Response.json({ error: "操作不存在" }, { status: 404 });
  return assetResourceHttp("deliverable", id, operation === "review" ? ["QA", "ADMIN"] : operation === "index" ? ["PM", "QA", "ADMIN"] : ["PM"], async (user, projectId) => {
    const actor = { actorId: user.id, ...getAuditRequestMetadata(request) }; const body = await request.json();
    if (operation === "versions") return Response.json({ data: await createDeliverable(projectId, deliverableCreateSchema.parse(body), actor, id) }, { status: 201 });
    if (operation === "index") {
      syncSchema.parse(body);
      await prisma.$transaction(async tx => {
        await lockAssetActor(tx, projectId, actor, ["PM", "QA", "ADMIN"]);
        const row = await tx.deliverable.findUniqueOrThrow({ where: { id } });
        if (row.status !== "APPROVED") throw new AssetError("只有已批准交付物可同步", 409);
        await queueAssetParse(tx, row.documentId, actor, projectId);
        await tx.syncFailure.deleteMany({ where: { entityId: row.documentId, target: "DOCUMENT_CHUNK_BUILD" } });
        await recordAudit(tx, { ...actor, projectId, action: "ASSET_INDEX_REQUESTED", entityType: "Deliverable", entityId: id, after: { documentId: row.documentId, cloudProcessingConfirmed: true } });
      });
      return Response.json({ data: { queued: true } });
    }
    return Response.json({ data: await mutateDeliverable(id, operation === "submit" ? "submit" : "review", operation === "submit" ? submitSchema.parse(body) : reviewSchema.parse(body), actor) });
  }, request);
}
