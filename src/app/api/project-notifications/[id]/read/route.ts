import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { recordAudit } from "@/modules/audit/service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser(); if (!actor) return Response.json({ error: "请先登录" }, { status: 401 }); const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "通知 ID 无效" }, { status: 400 });
  const readAt = await prisma.$transaction(async tx => {
    const row = await tx.projectNotification.findFirst({ where: { id, recipientId: actor.id } }); if (!row) return null;
    const changed = await tx.projectNotification.updateMany({ where: { id, recipientId: actor.id, readAt: null }, data: { readAt: new Date() } });
    if (changed.count) await recordAudit(tx, { actorId: actor.id, action: "PROJECT_NOTIFICATION_READ", entityType: "ProjectNotification", entityId: id, after: { projectId: row.projectId, acceptanceId: row.acceptanceId }, ...getAuditRequestMetadata(request) });
    return (await tx.projectNotification.findUniqueOrThrow({ where: { id } })).readAt;
  });
  return readAt ? Response.json({ data: { readAt } }) : Response.json({ error: "通知不存在或不可访问" }, { status: 404 });
}
