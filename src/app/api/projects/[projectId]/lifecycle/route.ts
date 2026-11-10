import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { assertProjectAccess } from "@/modules/auth/project-access";
import { projectErrorResponse } from "@/modules/projects/http";
import { projectCapabilities } from "@/modules/projects/capabilities";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await getCurrentUser(); if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
    const { projectId } = await params; if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "项目 ID 无效" }, { status: 400 });
    await assertProjectAccess(user, projectId);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { currentStatusChange: { include: { actor: { select: { name: true } } } }, currentAcceptance: true } });
    const history = await prisma.projectAcceptance.findMany({ where: { projectId }, select: { id: true, round: true, state: true, snapshotSha256: true, submittedAt: true, qaApprovedAt: true, reviewComment: true, closedAt: true, overrideReason: true, overrideGapCount: true }, orderBy: { round: "desc" }, take: 20 });
    const statusHistory = await prisma.projectStatusChange.findMany({ where: { projectId }, include: { actor: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
    const grant = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } }, select: { active: true, canOverrideAcceptance: true } });
    return Response.json({ data: { project, capabilities: projectCapabilities(project, user, !!(grant?.active && grant.canOverrideAcceptance)), history, statusHistory } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return projectErrorResponse(error); }
}
