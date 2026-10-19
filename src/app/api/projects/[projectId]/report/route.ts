import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { projectErrorResponse } from "@/modules/projects/http";
import { exportClosureReport } from "@/modules/projects/closure-report";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await getCurrentUser(); if (!user) return Response.json({ error: "请先登录" }, { status: 401 }); const { projectId } = await params;
    const input = z.object({ format: z.enum(["json", "html"]), preview: z.enum(["1"]).optional() }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!z.uuid().safeParse(projectId).success || !input.success) return Response.json({ error: "导出参数无效" }, { status: 400 });
    const content = await exportClosureReport(projectId, input.data.format, { actorId: user.id, ...getAuditRequestMetadata(request) });
    return new Response(content, { headers: { "Content-Type": input.data.format === "json" ? "application/json; charset=utf-8" : "text/html; charset=utf-8", "Content-Disposition": `${input.data.preview ? "inline" : "attachment"}; filename="project-closure-${projectId}.${input.data.format}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" } });
  } catch (error) { return projectErrorResponse(error); }
}
