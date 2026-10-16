import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { planningHttp } from "@/modules/planning/http";
import { weekSchema } from "@/modules/planning/schemas";
import { utcWeekStart } from "@/modules/planning/rules";
import { getProjectPlanning } from "@/modules/planning/services";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function GETHandler(request: Request, context: { params: Promise<{ projectId: string }> }) {
  return planningHttp(["ADMIN", "PM", "MEMBER", "QA"], async () => {
    const { projectId } = await context.params; const week = new URL(request.url).searchParams.get("weekStart") ?? utcWeekStart().toISOString().slice(0, 10);
    if (!z.uuid().safeParse(projectId).success || !weekSchema.safeParse(week).success) return Response.json({ error: "项目 ID 或周起始日期无效（请选择周一）" }, { status: 400 });
    return Response.json({ data: await getProjectPlanning(projectId, new Date(`${week}T00:00:00.000Z`)) }, { headers: { "Cache-Control": "no-store" } });
  });
}

export const GET = projectScoped(GETHandler);
