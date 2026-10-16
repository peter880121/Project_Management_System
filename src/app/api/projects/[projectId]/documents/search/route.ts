import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { documentHttp, documentReaders } from "@/modules/documents/http";
import { documentSearchSchema, searchProjectDocuments } from "@/modules/documents/rag-service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function POSTHandler(request: Request, context: { params: Promise<{ projectId: string }> }) {
  return documentHttp(documentReaders, async (actor) => {
    const { projectId } = await context.params;
    if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "项目 ID 无效" }, { status: 400 });
    const body = await request.json().catch(() => null); const parsed = documentSearchSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "检索参数无效", issues: parsed.error.issues }, { status: 400 });
    return Response.json({ data: await searchProjectDocuments(projectId, parsed.data, { actorId: actor.id, ...getAuditRequestMetadata(request) }) }, { headers: { "Cache-Control": "no-store" } });
  });
}

export const POST = projectScoped(POSTHandler);
