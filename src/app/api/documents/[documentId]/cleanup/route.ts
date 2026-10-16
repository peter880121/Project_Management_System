import { projectScoped } from "@/modules/auth/project-scope-http";
import { documentHttp } from "@/modules/documents/http";
import { documentId } from "@/modules/documents/validation";
import { retryDocumentCleanup } from "@/modules/documents/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function POSTHandler(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return documentHttp(["PM", "ADMIN"], async (actor) => Response.json({ data: await retryDocumentCleanup(documentId((await context.params).documentId), { actorId: actor.id, ...getAuditRequestMetadata(request) }) }));
}

export const POST = projectScoped(POSTHandler);
