import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { listSchema } from "./schemas";

// Callers must establish project membership before using these scoped queries.
export async function listRequirements(projectId: string, input: z.infer<typeof listSchema>) {
  const where: Prisma.RequirementWhereInput = { projectId, ...(input.state ? { workflowState: input.state, managed: true } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.ownerId ? { ownerId: input.ownerId } : {}), ...(input.q ? { OR: [{ title: { contains: input.q } }, { number: { contains: input.q } }] } : {}) };
  return prisma.$transaction(async tx => {
    const total = await tx.requirement.count({ where }); const page = Math.min(input.page, Math.max(1, Math.ceil(total / 20)));
    const [rows, counts] = await Promise.all([tx.requirement.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * 20, take: 20, select: { id: true, number: true, title: true, status: true, managed: true, workflowState: true, priority: true, category: true, riskLevel: true, ownerId: true, dueDate: true, completedAt: true, version: true, draftVersion: true, approvedVersion: true, rowVersion: true, targetRelease: true } }), tx.requirement.groupBy({ by: ["workflowState"], where: { projectId, managed: true }, _count: true })]);
    return { rows, total, page, pages: Math.max(1, Math.ceil(total / 20)), counts };
  });
}
export async function loadRequirement(projectId: string, id: string) {
  const row = await prisma.requirement.findFirst({ where: { id, projectId }, include: { revisions: { orderBy: { version: "desc" }, take: 100 }, changes: { orderBy: { createdAt: "desc" }, take: 100 }, taskLinks: { include: { task: { select: { id: true, title: true, status: true } } } }, tasks: { select: { id: true, title: true, status: true } }, testCases: { orderBy: { createdAt: "asc" } }, executions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 }, decisions: { orderBy: { createdAt: "desc" }, take: 100 }, intakes: { select: { id: true, title: true, source: true, sourceReference: true, attachments: { select: attachmentSelect } } }, attachments: { select: attachmentSelect, orderBy: { createdAt: "asc" } } } });
  if (row?.managed) {
    const pinned = await prisma.requirementRevision.findMany({ where: { projectId, requirementId: id, version: { in: [row.draftVersion, row.approvedVersion].filter((v): v is number => v !== null) } } });
    row.revisions = [...new Map([...pinned, ...row.revisions].map(r => [r.id, r])).values()].sort((a, b) => b.version - a.version);
    if (["IN_REVIEW", "CANCEL_REVIEW"].includes(row.workflowState)) {
      const request = await prisma.requirementDecision.findFirst({ where: { projectId, requirementId: id, action: row.workflowState === "IN_REVIEW" ? "SUBMIT" : "CANCEL", revisionNumber: row.draftVersion ?? row.approvedVersion ?? row.version }, orderBy: { createdAt: "desc" } });
      if (request && !row.decisions.some(d => d.id === request.id)) row.decisions.push(request);
    }
  }
  return row;
}
export const attachmentSelect = { id: true, filename: true, mediaType: true, sha256: true, fileSize: true, createdAt: true, revisionId: true, requirementId: true, intakeId: true } satisfies Prisma.RequirementAttachmentSelect;
export async function requirementOptions(projectId: string) {
  const [members, tasks, documents, requirements] = await Promise.all([
    prisma.user.findMany({ where: { status: "ACTIVE", isSystem: false, OR: [{ ownedProjects: { some: { id: projectId } } }, { projectMemberships: { some: { projectId, active: true } } }] }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.task.findMany({ where: { projectId, status: { not: "CANCELLED" } }, select: { id: true, title: true, status: true }, take: 500, orderBy: { title: "asc" } }),
    prisma.document.findMany({ where: { projectId, storageStatus: "AVAILABLE", meetingAttachmentId: null, documentType: { not: "MEETING" } }, select: { id: true, filename: true }, take: 100, orderBy: { createdAt: "desc" } }),
    prisma.requirement.findMany({ where: { projectId, managed: true }, select: { id: true, number: true, title: true, approvedVersion: true, draftVersion: true, workflowState: true }, orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  return { members, tasks, documents, requirements };
}
