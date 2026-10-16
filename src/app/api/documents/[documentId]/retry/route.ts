import { projectScoped } from "@/modules/auth/project-scope-http";
import { documentHttp } from "@/modules/documents/http";
import { documentId, DocumentError } from "@/modules/documents/validation";
import { parseRequestSchema, requestDocumentParse } from "@/modules/documents/parse-service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function POSTHandler(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return documentHttp(["PM", "ADMIN"], async (actor) => {
    const input = parseRequestSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new DocumentError("重试参数无效", 400);
    return Response.json({ data: await requestDocumentParse(documentId((await context.params).documentId), input.data, { actorId: actor.id, ...getAuditRequestMetadata(request) }, true) }, { status: 202 });
  });
}

export const POST = projectScoped(POSTHandler);
