import { prisma } from "@/lib/prisma";
import { assetHttp } from "@/modules/assets/http";
import { createBaseline } from "@/modules/requirements/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
type Context = { params: Promise<{ projectId: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN", "QA", "MEMBER", "PMO"], async () => Response.json({ data: await prisma.requirementBaseline.findMany({ where: { projectId }, orderBy: { ordinal: "desc" }, take: 50 }) }));
}
export async function POST(request: Request, { params }: Context) {
  const { projectId } = await params;
  return assetHttp(projectId, ["PM", "ADMIN"], async user => Response.json({ data: await createBaseline(projectId, await request.json(), { actorId: user.id, ...getAuditRequestMetadata(request) }) }, { status: 201 }), request);
}
