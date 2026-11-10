import { z } from "zod";
import { assetHttp } from "@/modules/assets/http";
import { uploadRequirementImage } from "@/modules/requirements/images";
import { readImageUpload } from "@/modules/requirements/image-http";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; intakeId: string }> }) {
  const { projectId, intakeId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN", "QA", "MEMBER"], async user => { z.uuid().parse(intakeId); return Response.json({ data: await uploadRequirementImage(projectId, { intakeId }, await readImageUpload(request), { actorId: user.id, ...getAuditRequestMetadata(request) }) }, { status: 201 }); }, request);
}
