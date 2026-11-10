import { z } from "zod";
import { assetHttp } from "@/modules/assets/http";
import { triageIntake } from "@/modules/requirements/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; intakeId: string }> }) {
  const { projectId, intakeId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN"], async user => { z.uuid().parse(intakeId); return Response.json({ data: await triageIntake(projectId, intakeId, await request.json(), { actorId: user.id, ...getAuditRequestMetadata(request) }) }); }, request);
}
