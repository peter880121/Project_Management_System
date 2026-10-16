import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata, type AuditAction } from "@/modules/audit/service";
import { lockBusinessActor } from "@/modules/auth/project-access";
import { findProject, findRequirement, findTask, findTestCase, insertProject, insertRequirement, insertTestCase, updateRequirement, updateTestCase, updateTaskRequirement } from "./repositories";
import type { createProjectSchema, TraceCreate, TraceUpdate } from "./schemas";

export class ProjectError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
type Actor = { actorId: string } & AuditRequestMetadata;
export async function createProject(data: z.infer<typeof createProjectSchema>, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, actor.actorId, ["PM"]);
    const project = await insertProject(tx, { ...data, ownerId: actor.actorId });
    await recordAudit(tx, { ...actor, projectId: project.id, action: "PROJECT_CREATED", entityType: "Project", entityId: project.id, after: { ...data, ownerId: actor.actorId, status: project.status } });
    return project;
  });
}

export async function saveTraceability(projectId: string, data: TraceCreate | TraceUpdate, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, actor.actorId, [data.kind === "testCase" ? "QA" : "PM"], projectId);
    if (!await findProject(tx, projectId)) throw new ProjectError("项目不存在", 404);
    let id: string;
    let before: Prisma.InputJsonValue | undefined;
    let after: Prisma.InputJsonValue;
    let action: AuditAction;
    if (data.kind === "requirement") {
      const fields = { title: data.title, content: data.content, status: data.status };
      if ("id" in data) {
        const old = await findRequirement(tx, projectId, data.id);
        if (!old) throw new ProjectError("项目内未找到需求", 404);
        const changed = await updateRequirement(tx, { where: { id: old.id, projectId, version: data.expectedVersion }, data: { ...fields, version: { increment: 1 } } });
        if (changed.count !== 1) throw new ProjectError("需求已更新，请刷新后重试", 409);
        id = old.id; before = { title: old.title, content: old.content, status: old.status, version: old.version };
        after = { ...fields, version: data.expectedVersion + 1 }; action = "REQUIREMENT_UPDATED";
      } else {
        const row = await insertRequirement(tx, { ...fields, projectId });
        id = row.id; after = { ...fields, version: row.version }; action = "REQUIREMENT_CREATED";
      }
    } else if (data.kind === "testCase") {
      const fields = { title: data.title, status: data.status };
      if ("id" in data) {
        const old = await findTestCase(tx, projectId, data.id);
        if (!old) throw new ProjectError("项目内未找到测试用例", 404);
        const changed = await updateTestCase(tx, { where: { id: old.id, updatedAt: new Date(data.expectedUpdatedAt), requirement: { projectId } }, data: { ...fields, ...(old.title !== fields.title ? { reviewedRequirementVersion: null, requirementReviewedById: null, requirementReviewedAt: null } : {}) } });
        if (changed.count !== 1) throw new ProjectError("测试用例已更新，请刷新后重试", 409);
        const invalidatedReview = old.title !== fields.title;
        id = old.id; before = { title: old.title, status: old.status, requirementId: old.requirementId, ...(invalidatedReview ? { reviewedRequirementVersion: old.reviewedRequirementVersion ?? null, requirementReviewedById: old.requirementReviewedById ?? null, requirementReviewedAt: old.requirementReviewedAt?.toISOString() ?? null } : {}) };
        after = { ...fields, requirementId: old.requirementId, ...(invalidatedReview ? { reviewedRequirementVersion: null, requirementReviewedById: null, requirementReviewedAt: null } : {}) }; action = "TEST_CASE_UPDATED";
      } else {
        if (!await findRequirement(tx, projectId, data.requirementId)) throw new ProjectError("项目内未找到需求", 404);
        const row = await insertTestCase(tx, { ...fields, requirementId: data.requirementId });
        id = row.id; after = { ...fields, requirementId: row.requirementId }; action = "TEST_CASE_CREATED";
      }
    } else {
      const old = await findTask(tx, projectId, data.id);
      if (!old) throw new ProjectError("项目内未找到任务", 404);
      if (data.requirementId && !await findRequirement(tx, projectId, data.requirementId)) throw new ProjectError("项目内未找到需求", 404);
      const changed = await updateTaskRequirement(tx, { where: { id: old.id, projectId, requirementId: data.expectedRequirementId }, data: { requirementId: data.requirementId, ...(old.requirementId !== data.requirementId ? { reviewedRequirementVersion: null, requirementReviewedById: null, requirementReviewedAt: null } : {}) } });
      if (changed.count !== 1) throw new ProjectError("任务关联已更新，请刷新后重试", 409);
      const invalidatedReview = old.requirementId !== data.requirementId;
      id = old.id; before = { requirementId: old.requirementId, ...(invalidatedReview ? { reviewedRequirementVersion: old.reviewedRequirementVersion ?? null, requirementReviewedById: old.requirementReviewedById ?? null, requirementReviewedAt: old.requirementReviewedAt?.toISOString() ?? null } : {}) }; after = { requirementId: data.requirementId, ...(invalidatedReview ? { reviewedRequirementVersion: null, requirementReviewedById: null, requirementReviewedAt: null } : {}) }; action = "TASK_REQUIREMENT_CHANGED";
    }
    await recordAudit(tx, { ...actor, projectId, action, entityType: data.kind === "requirement" ? "Requirement" : data.kind === "testCase" ? "TestCase" : "Task", entityId: id, before, after });
    return { id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
