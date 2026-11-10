import { assetHttp } from "@/modules/assets/http";
import { listRequirements, requirementOptions } from "@/modules/requirements/repositories";
import { listSchema } from "@/modules/requirements/schemas";
import { createRequirement } from "@/modules/requirements/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
type Context = { params: Promise<{ projectId: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN", "QA", "MEMBER", "PMO"], async () => {
    const query = new URL(request.url).searchParams;
    return Response.json({ data: await listRequirements(projectId, listSchema.parse(Object.fromEntries(query))), ...(query.get("options") === "1" ? { options: await requirementOptions(projectId) } : {}) });
  });
}
export async function POST(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN"], async user => Response.json({ data: await createRequirement(projectId, await request.json(), { actorId: user.id, ...getAuditRequestMetadata(request) }) }, { status: 201 }), request);
}
