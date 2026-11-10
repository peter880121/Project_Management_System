import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProjectError } from "@/modules/projects/services";
import type { ComplianceAuditInput } from "./types";
import { lockProject } from "@/modules/auth/transaction-locks";
import { loadAiTask } from "../task-context";

export type ScanFilters = { projectId: string; taskId?: string; actorFilter?: string; from?: Date; to?: Date };
const PAGE_SIZE = 200;
const CAP = 5000;
async function pages<T extends { id: string }>(read: (cursor?: string) => Promise<T[]>) {
  const rows: T[] = [];
  let cursor: string | undefined;
  while (rows.length < CAP) {
    const page = await read(cursor);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, complete: true };
    cursor = page[page.length - 1]!.id;
  }
  return { rows, complete: (await read(cursor)).length === 0 };
}
export async function loadComplianceSnapshot(input: ScanFilters, client?: Prisma.TransactionClient) {
  const read = async (tx: Prisma.TransactionClient) => {
    if (!await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true } })) throw new ProjectError("项目不存在", 404);
    const source = input.taskId ? await loadAiTask(input.projectId, input.taskId, "compliance", tx) : null;
    const cursorArgs = (cursor?: string) => ({ take: PAGE_SIZE, orderBy: { id: "asc" as const }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const links = await pages(cursor => tx.requirementTaskLink.findMany({ where: { projectId: input.projectId, ...(source ? { taskId: source.id } : {}) }, select: { id: true, taskId: true, requirementId: true }, ...cursorArgs(cursor) }));
    const requirementIds = [...new Set([...(source?.requirement ? [source.requirement.id] : []), ...links.rows.map(l => l.requirementId)])];
    const requirementScope = source ? { id: { in: requirementIds } } : {};
    const testScope = source ? { requirementId: { in: requirementIds } } : {};
    const tasks = await pages((cursor) => tx.task.findMany({ where: { projectId: input.projectId, ...(source ? { id: source.id } : {}) }, select: { id: true, status: true, requirementId: true, updatedAt: true, reviewedRequirementVersion: true }, ...cursorArgs(cursor) }));
    const requirements = await pages((cursor) => tx.requirement.findMany({ where: { projectId: input.projectId, ...requirementScope }, select: { id: true, updatedAt: true, version: true, status: true }, ...cursorArgs(cursor) }));
    const testCases = await pages((cursor) => tx.testCase.findMany({ where: { requirement: { projectId: input.projectId }, ...testScope }, select: { id: true, requirementId: true, status: true, reviewedRequirementVersion: true }, ...cursorArgs(cursor) }));
    const range = input.from || input.to ? { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } : undefined;
    const recordIds = [...tasks.rows, ...requirements.rows, ...testCases.rows].map(row => row.id);
    const logs = await tx.auditLog.findMany({ where: { projectId: input.projectId, ...(source ? { entityId: { in: recordIds } } : {}), ...(input.actorFilter ? { actorId: input.actorFilter } : {}), ...(range ? { createdAt: range } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101, select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actorId: true, before: true, after: true } });
    return {
      data: { taskRequirementLinks: links.rows, tasks: tasks.rows, requirements: requirements.rows, testCases: testCases.rows, auditLogs: logs.slice(0, 100) } satisfies ComplianceAuditInput,
      coverage: { complete: links.complete && tasks.complete && requirements.complete && testCases.complete, tasks: tasks.rows.length, requirements: requirements.rows.length, testCases: testCases.rows.length, auditLogs: Math.min(logs.length, 100), auditLogsTruncated: logs.length > 100, capPerEntity: CAP, semantics: "CURRENT_BUSINESS_SNAPSHOT_FILTERED_AUDIT_EVENTS" },
    };
  };
  return client ? read(client) : prisma.$transaction(read, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
export function insertSummary(tx: Prisma.TransactionClient, data: Prisma.AiSuggestionUncheckedCreateInput) { return tx.aiSuggestion.create({ data }); }
export function findSummary(tx: Prisma.TransactionClient, id: string) { return tx.aiSuggestion.findFirst({ where: { id, type: "AUDIT_SUMMARY" } }); }
export function listSummaries(projectId: string, page: number) {
  return prisma.aiSuggestion.findMany({ where: { projectId, type: "AUDIT_SUMMARY" }, select: { id: true, status: true, createdAt: true, reviewedAt: true, reviewedById: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (page - 1) * 20 });
}
export function summaryDetail(id: string) {
  return prisma.aiSuggestion.findFirst({ where: { id, type: "AUDIT_SUMMARY" }, include: { auditOccurrences: { select: { findingKey: true, issueId: true } }, findingReviews: { orderBy: { createdAt: "asc" } } } });
}
export const updateSummaryDecision = (tx: Prisma.TransactionClient, id: string, data: { status: "ACCEPTED" | "REJECTED"; reviewedById: string; reviewedAt: Date }) => tx.aiSuggestion.updateMany({ where: { id, type: "AUDIT_SUMMARY", status: "PENDING" }, data });
export const insertFindingReview = (tx: Prisma.TransactionClient, data: Prisma.ComplianceFindingReviewUncheckedCreateInput) => tx.complianceFindingReview.create({ data });
export async function lockQaReviewer(tx: Prisma.TransactionClient, actorId: string, projectId: string) {
  await lockProject(tx, projectId);
  await tx.$queryRaw`SELECT id FROM User WHERE id = ${actorId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, status: true, isSystem: true } });
  if (!user || user.role !== "QA" || user.status !== "ACTIVE" || user.isSystem) throw new ProjectError("仅有效 QA 账号可复核", 403);
}
