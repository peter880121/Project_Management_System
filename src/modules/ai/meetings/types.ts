import { z } from "zod";
import { planningDate } from "@/modules/planning/schemas";

export const MAX_TRANSCRIPT_CHARACTERS = 8000;
export const TOO_LONG_MESSAGE = "文本过长，请分段提炼";
// Conservative upper-bound estimate: CJK/punctuation can consume multiple tokens.
// Reserve 30% of the configured context for instructions and structured output.
export function transcriptFits(text: string, contextTokens = 32000, contextCharacters = 0) {
  return Array.from(text).length <= MAX_TRANSCRIPT_CHARACTERS && (text.length + contextCharacters) * 3 <= Math.floor(contextTokens * 0.7);
}
export const summarizeSchema = z.object({ text: z.string().trim().min(10).max(MAX_TRANSCRIPT_CHARACTERS, TOO_LONG_MESSAGE), expectedVersion: z.number().int().positive(), syntheticDataConfirmed: z.literal(true) }).strict();
export const modelActionSchema = z.object({ text: z.string().trim().min(1).max(191), suggestedAssigneeId: z.uuid().nullable(), suggestedAssigneeName: z.string().trim().min(1).max(191).nullable(), expectedDueDate: planningDate.nullable() }).strict();
export const summarySchema = z.object({ summary: z.string().trim().min(1).max(10000), actionItems: z.array(modelActionSchema).max(30) }).strict();
export const actionItemSchema = modelActionSchema.extend({ id: z.uuid(), checked: z.boolean(), suggestionId: z.uuid().optional(), taskId: z.uuid().optional(), convertedAt: z.iso.datetime().optional(), convertedById: z.uuid().optional() }).strict();
const legacyItemSchema = z.object({ id: z.uuid(), text: z.string().min(1).max(500), checked: z.boolean(), taskId: z.uuid().optional() }).strict();
export const storedItemsSchema = z.array(legacyItemSchema.extend({ suggestedAssigneeId: z.uuid().nullable().optional(), suggestedAssigneeName: z.string().max(191).nullable().optional(), expectedDueDate: planningDate.nullable().optional(), suggestionId: z.uuid().optional(), convertedAt: z.iso.datetime().optional(), convertedById: z.uuid().optional() }).strict()).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length);
export type MeetingActionItem = z.infer<typeof legacyItemSchema> & Partial<z.infer<typeof actionItemSchema>>;
export const summaryResultSchema = z.object({ suggestionId: z.uuid(), meetingId: z.uuid(), meetingVersion: z.number().int().positive(), summary: summarySchema.shape.summary, actionItems: z.array(actionItemSchema).max(30) }).strict();
export type MeetingSummaryResult = z.infer<typeof summaryResultSchema>;
export const meetingTaskSourceSchema = z.object({ meetingId: z.uuid(), actionItemId: z.uuid(), suggestionId: z.uuid().optional(), expectedVersion: z.number().int().positive(), visibilityExpansionConfirmed: z.literal(true) }).strict();
