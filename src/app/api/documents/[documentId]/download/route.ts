import { projectScoped } from "@/modules/auth/project-scope-http";
import { documentHttp, documentReaders } from "@/modules/documents/http";
import { documentId } from "@/modules/documents/validation";
import { downloadDocument } from "@/modules/documents/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function GETHandler(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return documentHttp(documentReaders, async (actor) => {
    const result = await downloadDocument(documentId((await context.params).documentId), { actorId: actor.id, ...getAuditRequestMetadata(request) });
    return new Response(new Uint8Array(result.bytes), { headers: { "Content-Type": result.mediaType ?? "application/octet-stream", "Content-Disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(result.filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Length": String(result.bytes.length) } });
  });
}

export const GET = projectScoped(GETHandler);
