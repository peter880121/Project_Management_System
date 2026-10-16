import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { documentHttp, documentReaders } from "@/modules/documents/http";
import { documentId, DocumentError, readUpload } from "@/modules/documents/validation";
import { listDocuments } from "@/modules/documents/repositories";
import { uploadDocument } from "@/modules/documents/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
type Context = { params: Promise<{ projectId: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function GETHandler(request: Request, context: Context) {
  return documentHttp(documentReaders, async () => {
    const parsed = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new DocumentError("分页参数无效", 400);
    return Response.json({ data: await listDocuments(documentId((await context.params).projectId), parsed.data.page), page: parsed.data.page });
  });
}
function POSTHandler(request: Request, context: Context) {
  return documentHttp(["PM"], async (actor) => {
    const projectId = documentId((await context.params).projectId);
    const result = await uploadDocument(projectId, await readUpload(request), { actorId: actor.id, ...getAuditRequestMetadata(request) });
    return Response.json({ data: result }, { status: result.duplicate ? 200 : 201 });
  });
}

export const GET = projectScoped(GETHandler);
export const POST = projectScoped(POSTHandler);
