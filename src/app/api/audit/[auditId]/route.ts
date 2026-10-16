import { projectScoped } from "@/modules/auth/project-scope-http";
import { prisma } from "@/lib/prisma";
import { complianceHttp, parseId } from "@/modules/ai/compliance-audit/http";
import { ProjectError } from "@/modules/projects/services";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function GETHandler(_request: Request, context: { params: Promise<{ auditId: string }> }) {
  return complianceHttp(["ADMIN", "QA"], async () => {
    const data = await prisma.auditLog.findUnique({ where: { id: parseId((await context.params).auditId) }, include: { actor: { select: { id: true, name: true, role: true } } } });
    if (!data) throw new ProjectError("审计记录不存在", 404);
    return Response.json({ data });
  });
}

export const GET = projectScoped(GETHandler);
