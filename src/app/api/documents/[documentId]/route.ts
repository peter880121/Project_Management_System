import { projectScoped } from "@/modules/auth/project-scope-http";
import { prisma } from "@/lib/prisma";
import { documentHttp, documentReaders } from "@/modules/documents/http";
import { documentId, DocumentError } from "@/modules/documents/validation";
import { publicDocumentSelect } from "@/modules/documents/repositories";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function GETHandler(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  return documentHttp(documentReaders, async () => {
    const data = await prisma.document.findUnique({ where: { id: documentId((await context.params).documentId) }, select: publicDocumentSelect });
    if (!data) throw new DocumentError("文档不存在", 404);
    return Response.json({ data });
  });
}

export const GET = projectScoped(GETHandler);
