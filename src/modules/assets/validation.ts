import { z } from "zod";
export const roles = ["ADMIN", "PM", "QA", "MEMBER"] as const;
export const deliverableCreateSchema = z.object({ name: z.string().trim().min(1).max(191), documentId: z.uuid(), taskId: z.uuid().optional() }).strict();
export const deliverableEditSchema = z.object({ name: z.string().trim().min(1).max(191), rowVersion: z.number().int().positive() }).strict();
export const submitSchema = z.object({ rowVersion: z.number().int().positive(), cloudProcessingConfirmed: z.literal(true) }).strict();
export const reviewSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), rowVersion: z.number().int().positive(), reviewComment: z.string().trim().max(2000).default("") }).strict().refine(v => v.decision !== "REJECTED" || !!v.reviewComment, "拒绝时必须填写原因");
export const meetingSchema = z.object({ title: z.string().trim().min(1).max(191), meetingDate: z.iso.datetime(), content: z.string().trim().min(1).max(50000), requestKey: z.uuid(), visibleRoles: z.array(z.enum(roles)).min(1).max(4).refine(v => new Set(v).size === v.length), actionItems: z.array(z.object({ id: z.uuid(), text: z.string().trim().min(1).max(500), checked: z.boolean(), taskId: z.uuid().optional() }).strict()).max(100) }).strict();
export const syncSchema = z.object({ cloudProcessingConfirmed: z.literal(true) }).strict();
export class AssetError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export function canReadRoles(visible: unknown, role: string) { return role === "ADMIN" || Array.isArray(visible) && visible.includes(role); }
