import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { projectErrorResponse } from "@/modules/projects/http";
import { transitionProject, transitionSchema, type ProjectAction } from "@/modules/projects/acceptance";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; projectAction: string }> }) {
  const { projectId, projectAction } = await params;
  if (!["activate", "submit-acceptance", "qa-approve", "archive", "reject-acceptance", "withdraw-acceptance"].includes(projectAction)) return Response.json({ error: "操作不存在" }, { status: 404 });
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "项目 ID 无效" }, { status: 400 });
  try {
    const user = await getCurrentUser(); if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
    const parsed = transitionSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: "验收参数无效" }, { status: 400 });
    return Response.json({ data: await transitionProject(projectId, projectAction as ProjectAction, parsed.data, { actorId: user.id, ...getAuditRequestMetadata(request) }) });
  } catch (error) { return projectErrorResponse(error); }
}
