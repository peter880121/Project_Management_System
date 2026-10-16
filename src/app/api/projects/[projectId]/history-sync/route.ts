import { projectScoped } from "@/modules/auth/project-scope-http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { recordAudit } from "@/modules/audit/service";
import { retryProjectHistorySync } from "@/modules/ai/wbs/history";
import { projectErrorResponse } from "@/modules/projects/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function POSTHandler(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = await getCurrentUser();
    const denied = requireRole(actor, ["PM"]);
    if (denied || !actor) return denied!;
    const { projectId } = await context.params;
    if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "项目 ID 无效" }, { status: 400 });
    if (!await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })) return Response.json({ error: "项目不存在" }, { status: 404 });
    await prisma.$transaction((tx) => recordAudit(tx, { actorId: actor.id, projectId, action: "VECTOR_SYNC_RETRIED", entityType: "HistorySync", entityId: randomUUID(), after: { phase: "REQUESTED", batchLimit: 5 }, ...getAuditRequestMetadata(request) }));
    return Response.json({ data: await retryProjectHistorySync(projectId) });
  } catch (error) { return projectErrorResponse(error); }
}

export const POST = projectScoped(POSTHandler);
