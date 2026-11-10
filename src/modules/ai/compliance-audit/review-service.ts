import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { ProjectError } from "@/modules/projects/services";
import { findRequirement, findTask, findTestCase, updateTaskRequirement, updateTestCase } from "@/modules/projects/repositories";
import { findSummary, insertFindingReview, updateSummaryDecision, lockQaReviewer } from "./repositories";
import { registerScanIssues, findingFingerprint } from "@/modules/audit/issue-service";

const note = z.string().trim().min(1).max(2000);
export const decisionSchema = z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]), note }).strict();
export const findingReviewSchema = z.object({ decision: z.enum(["CONFIRMED", "DISMISSED"]), note }).strict();
export const versionReviewSchema = z.object({ entityType: z.enum(["Task", "TestCase"]), entityId: z.uuid(), expectedRequirementId: z.uuid(), expectedRequirementVersion: z.number().int().positive(), expectedUpdatedAt: z.iso.datetime(), note }).strict();
type Actor = { actorId: string } & AuditRequestMetadata;
export async function reviewSummary(id: string, data: z.infer<typeof decisionSchema>, actor: Actor) {
  const scope = await prisma.aiSuggestion.findUnique({ where: { id }, select: { projectId: true } });
  if (!scope) throw new ProjectError("摘要不存在", 404);
  return prisma.$transaction(async (tx) => {
    await lockQaReviewer(tx, actor.actorId, scope.projectId);
    const summary = await findSummary(tx, id);
    if (!summary) throw new ProjectError("摘要不存在", 404);
    const changed = await updateSummaryDecision(tx, id, { status: data.decision, reviewedById: actor.actorId, reviewedAt: new Date() });
    if (changed.count !== 1) throw new ProjectError("摘要已经复核，请刷新", 409);
    await recordAudit(tx, { ...actor, projectId: summary.projectId, action: data.decision === "ACCEPTED" ? "AI_SUGGESTION_ACCEPTED" : "AI_SUGGESTION_REJECTED", entityType: "AuditSummary", entityId: id, before: { status: summary.status }, after: { status: data.decision, note: data.note, reviewedById: actor.actorId } });
    return { id, status: data.decision };
  });
}
export async function reviewFinding(id: string, findingKey: string, data: z.infer<typeof findingReviewSchema>, actor: Actor) {
  const scope = await prisma.aiSuggestion.findUnique({ where: { id }, select: { projectId: true } });
  if (!scope) throw new ProjectError("摘要不存在", 404);
  return prisma.$transaction(async (tx) => {
    await lockQaReviewer(tx, actor.actorId, scope.projectId);
    const summary = await findSummary(tx, id);
    if (!summary) throw new ProjectError("摘要不存在", 404);
    const output = z.object({ findings: z.array(z.object({ findingKey: z.string(), code: z.string(), summary: z.string(), recordIds: z.array(z.string()), auditIds: z.array(z.string()), requirementVersion: z.number().nullable(), sourceAuditMissing: z.boolean() })) }).safeParse(summary.output);
    const finding = output.success ? output.data.findings.find((row) => row.findingKey === findingKey) : undefined;
    if (!finding) throw new ProjectError("本次扫描未找到该问题", 404);
    const review = await insertFindingReview(tx, { suggestionId: id, findingKey, ...data, reviewedById: actor.actorId });
    const occurrence = await tx.auditIssueOccurrence.findUnique({ where: { summaryId_findingKey: { summaryId: id, findingKey } } });
    if (!occurrence) await registerScanIssues(tx, summary.projectId, id, [finding], actor);
    const issue = await tx.auditIssue.findUniqueOrThrow({ where: { projectId_fingerprint: { projectId: summary.projectId, fingerprint: findingFingerprint(finding) } } });
    if (issue.status === "PENDING") {
      const next = data.decision === "CONFIRMED" ? "OPEN" : "DISMISSED";
      await tx.auditIssue.update({ where: { id: issue.id }, data: { status: next, rowVersion: { increment: 1 } } });
      await tx.auditIssueEvent.create({ data: { issueId: issue.id, actorId: actor.actorId, action: data.decision === "CONFIRMED" ? "CONFIRM" : "DISMISS", fromStatus: "PENDING", toStatus: next, note: data.note, evidence: { reviewId: review.id, summaryId: id } } });
    }
    await recordAudit(tx, { ...actor, projectId: summary.projectId, action: "COMPLIANCE_FINDING_REVIEWED", entityType: "ComplianceFindingReview", entityId: review.id, after: { suggestionId: id, findingKey, ...data, evidence: finding } });
    return review;
  });
}
export async function reviewRequirementVersion(projectId: string, data: z.infer<typeof versionReviewSchema>, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lockQaReviewer(tx, actor.actorId, projectId);
    const entity = data.entityType === "Task" ? await findTask(tx, projectId, data.entityId) : await findTestCase(tx, projectId, data.entityId);
    if (!entity) throw new ProjectError("项目内未找到记录", 404);
    if (entity.updatedAt.toISOString() !== data.expectedUpdatedAt) throw new ProjectError("记录已变化，请刷新", 409);
    const requirement = await findRequirement(tx, projectId, data.expectedRequirementId);
    if (!requirement || entity.requirementId !== requirement.id || requirement.version !== data.expectedRequirementVersion) throw new ProjectError("需求版本或关联已变化，请刷新", 409);
    if (entity.reviewedRequirementVersion === requirement.version) throw new ProjectError("当前需求版本已经复核", 409);
    const fields = { reviewedRequirementVersion: requirement.version, requirementReviewedById: actor.actorId, requirementReviewedAt: new Date() };
    const where = { id: entity.id, requirementId: requirement.id, reviewedRequirementVersion: entity.reviewedRequirementVersion, updatedAt: entity.updatedAt };
    const changed = data.entityType === "Task" ? await updateTaskRequirement(tx, { where, data: fields }) : await updateTestCase(tx, { where, data: fields });
    if (changed.count !== 1) throw new ProjectError("记录已变化，请刷新", 409);
    await recordAudit(tx, { ...actor, projectId, action: "REQUIREMENT_VERSION_REVIEWED", entityType: data.entityType, entityId: entity.id, before: { reviewedRequirementVersion: entity.reviewedRequirementVersion, requirementReviewedById: entity.requirementReviewedById, requirementReviewedAt: entity.requirementReviewedAt?.toISOString() ?? null }, after: { requirementId: requirement.id, reviewedRequirementVersion: requirement.version, reviewedById: actor.actorId, reviewedAt: fields.requirementReviewedAt.toISOString(), note: data.note } });
    return { id: entity.id, ...fields };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
