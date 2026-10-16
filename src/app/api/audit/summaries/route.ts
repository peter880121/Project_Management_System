import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { complianceHttp } from "@/modules/ai/compliance-audit/http";
import { listSummaries } from "@/modules/ai/compliance-audit/repositories";
import { ProjectError } from "@/modules/projects/services";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function GETHandler(request: Request) {
  return complianceHttp(["ADMIN", "QA"], async () => {
    const parsed = z.object({ projectId: z.uuid(), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ProjectError("筛选参数无效", 400);
    return Response.json({ data: await listSummaries(parsed.data.projectId, parsed.data.page), page: parsed.data.page });
  });
}

export const GET = projectScoped(GETHandler);
