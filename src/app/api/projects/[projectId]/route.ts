import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { projectScoped } from "@/modules/auth/project-scope-http";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { projectErrorResponse } from "@/modules/projects/http";
import { projectMaintenanceSchema } from "@/modules/projects/maintenance-schema";
import { maintainProject } from "@/modules/projects/maintenance";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/modules/auth/rbac";
export const dynamic = "force-dynamic";
export const GET = projectScoped(async (_request: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  const user = await getCurrentUser(); const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]); if (denied) return denied;
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "项目 ID 无效" }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, description: true, ownerId: true, status: true, rowVersion: true, owner: { select: { id: true, name: true } } } });
  return project ? Response.json({ data: project }) : Response.json({ error: "项目不存在" }, { status: 404 });
});
export const PATCH = projectScoped(async (request: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  try {
    const user = await getCurrentUser(); if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
    const { projectId } = await params;
    const parsed = projectMaintenanceSchema.safeParse(await request.json().catch(() => null));
    if (!z.uuid().safeParse(projectId).success || !parsed.success) return Response.json({ error: "项目修改参数无效，交接说明须为 10–1000 字" }, { status: 400 });
    return Response.json({ data: await maintainProject(projectId, parsed.data, { actorId: user.id, ...getAuditRequestMetadata(request) }) });
  } catch (error) { return projectErrorResponse(error); }
});
