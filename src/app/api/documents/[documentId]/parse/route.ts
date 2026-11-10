import { projectScoped } from "@/modules/auth/project-scope-http";
import { documentHttp, documentReaders } from "@/modules/documents/http";
import { documentId, DocumentError } from "@/modules/documents/validation";
import { parseRequestSchema, requestDocumentParse } from "@/modules/documents/parse-service";
import { listParseJobs } from "@/modules/documents/parse-repositories";
import { findDocument } from "@/modules/documents/repositories";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
type Context = { params: Promise<{ documentId: string }> };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function GETHandler(_request: Request, context: Context) {
  return documentHttp(documentReaders, async () => {
    const id = documentId((await context.params).documentId);
    if (!await findDocument(id)) throw new DocumentError("文档不存在", 404);
    return Response.json({ data: await listParseJobs(id) });
  });
}
function POSTHandler(request: Request, context: Context) {
  return documentHttp(["PM", "ADMIN"], async (actor) => {
    const input = parseRequestSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new DocumentError("请提供有效解析版本、请求标识和处理确认参数", 400);
    return Response.json({ data: await requestDocumentParse(documentId((await context.params).documentId), input.data, { actorId: actor.id, ...getAuditRequestMetadata(request) }) }, { status: 202 });
  });
}

export const GET = projectScoped(GETHandler);
export const POST = projectScoped(POSTHandler);
