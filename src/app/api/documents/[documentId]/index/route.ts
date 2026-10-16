import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { documentHttp, documentReaders } from "@/modules/documents/http";
import { getDocumentRagStatus, retryDocumentVectors } from "@/modules/documents/rag-service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ documentId: string }> };
async function GETHandler(_request: Request, context: Context) {
  return documentHttp(documentReaders, async () => {
    const { documentId } = await context.params;
    if (!z.uuid().safeParse(documentId).success) return Response.json({ error: "文档 ID 无效" }, { status: 400 });
    return Response.json({ data: await getDocumentRagStatus(documentId) }, { headers: { "Cache-Control": "no-store" } });
  });
}
async function POSTHandler(request: Request, context: Context) {
  return documentHttp(["ADMIN", "PM"], async (actor) => {
    const { documentId } = await context.params;
    const parsed = z.object({ version: z.number().int().positive() }).strict().safeParse(await request.json().catch(() => null));
    if (!z.uuid().safeParse(documentId).success || !parsed.success) return Response.json({ error: "重试参数无效" }, { status: 400 });
    return Response.json({ data: await retryDocumentVectors(documentId, parsed.data.version, { actorId: actor.id, ...getAuditRequestMetadata(request) }) }, { status: 202 });
  });
}

export const GET = projectScoped(GETHandler);
export const POST = projectScoped(POSTHandler);
