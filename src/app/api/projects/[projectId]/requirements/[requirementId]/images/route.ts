import { z } from "zod";
import { assetHttp } from "@/modules/assets/http";
import { uploadRequirementImage } from "@/modules/requirements/images";
import { readImageUpload } from "@/modules/requirements/image-http";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; requirementId: string }> }) {
  const { projectId, requirementId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN"], async user => { z.uuid().parse(requirementId); return Response.json({ data: await uploadRequirementImage(projectId, { requirementId }, await readImageUpload(request), { actorId: user.id, ...getAuditRequestMetadata(request) }) }, { status: 201 }); }, request);
}
