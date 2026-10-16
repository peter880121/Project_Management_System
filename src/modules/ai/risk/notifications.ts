import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { lockPlanningActor } from "@/modules/planning/repositories";
import { PlanningError } from "@/modules/planning/schemas";
import * as repository from "./scheduler-repositories";
export async function notifyRiskSuggestions(tx: Prisma.TransactionClient, input: { actorId: string; projectId: string; recipientIds: string[]; suggestionIds: string[] }) {
  if (!input.suggestionIds.length) return;
  const recipients = await repository.notificationRecipients(tx, [...new Set(input.recipientIds)], input.projectId);
  const result = await repository.insertNotifications(tx, recipients.flatMap((user) => input.suggestionIds.map((suggestionId) => ({ userId: user.id, suggestionId }))));
  if (result.count) await recordAudit(tx, { actorId: input.actorId, projectId: input.projectId, action: "RISK_NOTIFICATIONS_CREATED", entityType: "Project", entityId: input.projectId, after: { recipientIds: recipients.map((row) => row.id), suggestionIds: input.suggestionIds, count: result.count }, userAgent: "risk-notifications" });
}
export async function getRiskNotifications(userId: string, page: number) {
  return prisma.$transaction(async (tx) => {
    const rows = await repository.listNotifications(tx, userId, page); const unread = await repository.unreadCount(tx, userId);
    return { unreadCount: unread, hasMore: rows.length > 20, data: rows.slice(0, 20).map((row) => {
      const output = row.suggestion.output; const title = output && typeof output === "object" && !Array.isArray(output) && typeof output.taskTitle === "string" ? output.taskTitle.slice(0, 191) : "项目风险";
      return { id: row.id, suggestionId: row.suggestionId, title, readAt: row.readAt, createdAt: row.createdAt, status: row.suggestion.status, sourceUrl: `/notifications/${row.id}` };
    }) };
  }, { isolationLevel: "RepeatableRead" });
}
export async function getRiskNotificationDetail(id: string, userId: string) {
  const row = await repository.notificationDetail(id, userId); if (!row) throw new PlanningError("通知不存在", 404); return row;
}
export async function readRiskNotification(id: string, actor: { actorId: string } & AuditRequestMetadata) {
  const scope = await prisma.riskNotification.findFirst({ where: { id, userId: actor.actorId }, select: { suggestion: { select: { projectId: true } } } });
  if (!scope) throw new PlanningError("通知不存在", 404);
  return prisma.$transaction(async (tx) => {
    await lockPlanningActor(tx, actor.actorId, scope.suggestion.projectId);
    const notification = await repository.findNotification(tx, id, actor.actorId); if (!notification) throw new PlanningError("通知不存在", 404);
    if (notification.readAt) return { readAt: notification.readAt };
    const readAt = new Date(); await repository.markNotificationRead(tx, id, actor.actorId, readAt);
    await recordAudit(tx, { ...actor, projectId: notification.suggestion.projectId, action: "RISK_NOTIFICATION_READ", entityType: "RiskNotification", entityId: id, before: { readAt: null }, after: { readAt: readAt.toISOString(), suggestionId: notification.suggestionId } });
    return { readAt };
  }, { isolationLevel: "ReadCommitted" });
}
