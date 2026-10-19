import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { canReadRoles } from "@/modules/assets/validation";
import { ProjectError } from "@/modules/projects/services";
import { storedItemsSchema, summaryResultSchema } from "./types";

export function contentSha(content: string) { return createHash("sha256").update(content).digest("hex"); }
export async function loadMeetingTx(tx: Prisma.TransactionClient, projectId: string, meetingId: string, role: string) {
  const row = await tx.meetingRecord.findFirst({ where: { id: meetingId, projectId } });
  if (!row) throw new ProjectError("会议纪要不存在", 404);
  if (!canReadRoles(row.visibleRoles, role)) throw new ProjectError("无权访问此会议纪要", 403);
  return row;
}
export function assertDraft(row: { status: string; rowVersion: number }, expectedVersion: number) {
  if (row.status !== "DRAFT") throw new ProjectError("纪要已定稿，请复制为新草稿后提炼", 409);
  if (row.rowVersion !== expectedVersion) throw new ProjectError("纪要已变化，请刷新后重试", 409);
}
export async function loadSuggestionTx(tx: Prisma.TransactionClient, projectId: string, meeting: { id: string; content: string; meetingDate: Date; title: string }, suggestionId: string) {
  const row = await tx.aiSuggestion.findFirst({ where: { id: suggestionId, projectId, type: "MEETING_SUMMARY", status: { in: ["PENDING", "ACCEPTED"] } } });
  if (!row) throw new ProjectError("会议 AI 建议不存在或不可采纳", 404);
  const input = row.input as Record<string, unknown>;
  if (input.meetingId !== meeting.id) throw new ProjectError("建议不属于当前会议", 403);
  // Accepted suggestions can be reused for individual items after explicit summary adoption.
  if (row.status === "PENDING" && (input.contentSha256 !== contentSha(meeting.content) || input.meetingDate !== meeting.meetingDate.toISOString() || input.titleSha256 !== contentSha(meeting.title))) throw new ProjectError("会议正文已变化，请重新提炼", 409);
  return { row, result: summaryResultSchema.parse(row.output) };
}
export const readItems = (value: unknown) => storedItemsSchema.parse(value);
