import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const auditQuerySchema = z.object({
  projectId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
    context.addIssue({ code: "custom", path: ["to"], message: "to must be at or after from" });
  }
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export function buildAuditWhere(query: AuditQuery): Prisma.AuditLogWhereInput {
  const { projectId, actorId, action, from, to } = query;
  return {
    ...(projectId ? { projectId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(action ? { action } : {}),
    ...(from || to ? {
      createdAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      },
    } : {}),
  };
}
