import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { ProjectError } from "@/modules/projects/services";
import { lockAssetActor } from "./services";
import { assertDraft, contentSha, loadMeetingTx, loadSuggestionTx, readItems } from "@/modules/ai/meetings/repository";
export const meetingEditSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), expectedVersion: z.number().int().positive(), title: z.string().trim().min(1).max(191), content: z.string().trim().min(1).max(50000), meetingDate: z.iso.datetime() }).strict(),
  z.object({ action: z.literal("apply"), expectedVersion: z.number().int().positive(), suggestionId: z.uuid() }).strict(),
  z.object({ action: z.literal("finalize"), expectedVersion: z.number().int().positive() }).strict(),
]);
export async function editMeeting(projectId: string, meetingId: string, input: z.infer<typeof meetingEditSchema>, actor: { actorId: string } & AuditRequestMetadata) {
  return prisma.$transaction(async tx => {
    const user = await lockAssetActor(tx, projectId, actor, ["PM"]);
    const row = await loadMeetingTx(tx, projectId, meetingId, user.role); assertDraft(row, input.expectedVersion);
    const data: { title?: string; content?: string; meetingDate?: Date; actionItems?: ReturnType<typeof readItems>; status?: "FINALIZED" } = {};
    if (input.action === "save") Object.assign(data, { title: input.title, content: input.content, meetingDate: new Date(input.meetingDate) });
    if (input.action === "finalize") data.status = "FINALIZED";
    if (input.action === "apply") {
      const suggestion = await loadSuggestionTx(tx, projectId, row, input.suggestionId);
      const items = readItems(row.actionItems); const ids = new Set(items.map(item => item.id));
      const combined = [...items, ...suggestion.result.actionItems.filter(item => !ids.has(item.id))];
      if (combined.length > 100) throw new ProjectError("行动项超过 100 条，请先拆分会议", 400);
      Object.assign(data, { content: suggestion.result.summary, actionItems: combined });
      await tx.aiSuggestion.update({ where: { id: input.suggestionId }, data: { status: "ACCEPTED", reviewedById: actor.actorId, reviewedAt: new Date() } });
      await recordAudit(tx, { ...actor, projectId, action: "AI_SUGGESTION_ACCEPTED", entityType: "AiSuggestion", entityId: input.suggestionId, after: { meetingId, adoption: "SUMMARY_AND_ACTION_ITEMS" } });
    }
    const updated = await tx.meetingRecord.update({ where: { id: row.id }, data: { ...data, rowVersion: { increment: 1 } } });
    await recordAudit(tx, { ...actor, projectId, action: input.action === "finalize" ? "MEETING_FINALIZED" : "MEETING_UPDATED", entityType: "MeetingRecord", entityId: meetingId, before: { rowVersion: row.rowVersion, contentSha256: contentSha(row.content) }, after: { rowVersion: updated.rowVersion, status: updated.status, contentSha256: contentSha(updated.content), actionItemCount: readItems(updated.actionItems).length } });
    return updated;
  });
}
