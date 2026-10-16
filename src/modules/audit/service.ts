import { randomUUID } from "node:crypto";
import type { Prisma, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canTransitionTaskStatus } from "@/modules/tasks/status";
import { assertProjectAccessTx, participant, ProjectAccessError, lockBusinessActor } from "@/modules/auth/project-access";
import { BusinessError } from "./errors";
import { prerequisiteMessage, suggestionTitle } from "@/modules/ai/wbs/review-state";

async function taskProjectId(id: string) {
  const row = await prisma.task.findUnique({ where: { id }, select: { projectId: true } });
  if (!row) throw new BusinessError("Task not found", 404);
  return row.projectId;
}
async function suggestionProjectId(id: string) {
  const row = await prisma.aiSuggestion.findUnique({ where: { id }, select: { projectId: true } });
  if (!row) throw new BusinessError("AI suggestion not found", 404);
  return row.projectId;
}

export type AuditAction =
  | "PROJECT_MEMBER_UPDATED"
  | "COMPLIANCE_EXPORT_PREPARED"
  | "COMPLIANCE_EXPORT_FAILED"
  | "COMPLIANCE_EXPORT_CLEANED"
  | "RISK_SCHEDULE_UPDATED"
  | "RISK_JOB_QUEUED"
  | "RISK_JOB_STARTED"
  | "RISK_JOB_COMPLETED"
  | "RISK_JOB_FAILED"
  | "RISK_JOB_SKIPPED"
  | "RISK_JOB_RETRIED"
  | "RISK_NOTIFICATIONS_CREATED"
  | "RISK_NOTIFICATION_READ"
  | "TASK_SCHEDULE_UPDATED"
  | "MEMBER_CAPACITY_UPDATED"
  | "DOCUMENT_CHUNKED"
  | "DOCUMENT_CHUNK_FAILED"
  | "DOCUMENT_VECTOR_SYNCED"
  | "DOCUMENT_VECTOR_FAILED"
  | "DOCUMENT_PARSE_REQUESTED"
  | "DOCUMENT_PARSE_STARTED"
  | "DOCUMENT_PARSE_SUCCEEDED"
  | "DOCUMENT_PARSE_FAILED"
  | "DOCUMENT_PARSE_ARTIFACT_CLEANED"
  | "DOCUMENT_UPLOAD_STARTED"
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_UPLOAD_FAILED"
  | "DOCUMENT_UPLOAD_RECOVERED"
  | "DOCUMENT_CLEANUP_RETRIED"
  | "REQUIREMENT_VERSION_REVIEWED"
  | "COMPLIANCE_FINDING_REVIEWED"
  | "PROJECT_CREATED"
  | "REQUIREMENT_CREATED"
  | "REQUIREMENT_UPDATED"
  | "TEST_CASE_CREATED"
  | "TEST_CASE_UPDATED"
  | "TASK_REQUIREMENT_CHANGED"
  | "VECTOR_SYNC_RETRIED"
  | "TASK_CREATED"
  | "TASK_STATUS_CHANGED"
  | "TASK_ASSIGNED"
  | "PERMISSION_CHANGED"
  | "USER_CREATED_BY_ADMIN"
  | "USER_STATUS_CHANGED"
  | "DATA_EXPORTED"
  | "AI_SUGGESTION_ACCEPTED"
  | "AI_SUGGESTION_REJECTED"
  | "AI_WBS_GENERATED"
  | "AI_WBS_GENERATION_FAILED"
  | "AI_AUDIT_SUMMARY_GENERATED"
  | "AI_RISK_SUGGESTIONS_GENERATED"
  | "AI_RISK_SUGGESTION_HANDLED"
  | "AI_RISK_SUGGESTION_IGNORED"
  | "RAG_SEARCH"
  | "LOGOUT"
  | "PASSWORD_CHANGED";

const acceptedWbsPayloadSchema = z.object({
  title: z.string().min(1).max(191),
  description: z.string().max(5000),
  estimateHours: z.number().finite().positive().max(10_000),
  suggestedRole: z.enum(["PM", "MEMBER", "QA", "ADMIN"]),
  dependencyIds: z.array(z.uuid()).max(30),
  dependencyTitles: z.array(z.string()).max(30),
  sourceChunkIds: z.array(z.uuid()).max(4).optional(),
  taskId: z.uuid().optional(),
}).strict();

export async function createTask(input: {
  projectId: string;
  title: string;
  description?: string;
  requirementId?: string;
  actorId: string;
} & AuditRequestMetadata) {
  return prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, input.actorId, ["ADMIN", "PM"], input.projectId);
    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    if (!project) throw new BusinessError("Project not found", 404);
    if (input.requirementId) {
      const requirement = await tx.requirement.findFirst({ where: { id: input.requirementId, projectId: input.projectId }, select: { id: true } });
      if (!requirement) throw new BusinessError("Requirement not found in this project", 404);
    }
    const task = await tx.task.create({ data: {
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      requirementId: input.requirementId,
    } });
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: input.projectId,
      action: "TASK_CREATED",
      entityType: "Task",
      entityId: task.id,
      after: { title: task.title, status: task.status, requirementId: task.requirementId },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return task;
  });
}

export type AuditRequestMetadata = Readonly<{
  ip?: string | null;
  userAgent?: string | null;
}>;

export type AuditEvent = Readonly<{
  actorId: string;
  projectId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}> & AuditRequestMetadata;

/** Audit writes require a transaction client so callers can commit them atomically with business changes. */
export async function recordAudit(tx: Prisma.TransactionClient, event: AuditEvent) {
  if (event.projectId) await assertProjectAccessTx(tx, event.actorId, event.projectId);
  return tx.auditLog.create({
    data: {
      actorId: event.actorId,
      projectId: event.projectId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: event.before,
      after: event.after,
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
    },
  });
}

export async function changeTaskStatus(input: {
  taskId: string;
  status: TaskStatus;
  actualHours?: number;
  actorId: string;
} & AuditRequestMetadata) {
  const projectId = await taskProjectId(input.taskId);
  return prisma.$transaction(async (tx) => {
    const actor = await lockBusinessActor(tx, input.actorId, ["ADMIN", "PM", "MEMBER"], projectId);
    const task = await tx.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw new BusinessError("Task not found", 404);
    if (actor.role === "MEMBER" && (task.assigneeId !== input.actorId || task.status === "DONE")) throw new ProjectAccessError("成员仅可更新本人负责且未完成的任务");
    if (input.status === "DONE" && (!input.actualHours || input.actualHours <= 0 || !Number.isFinite(input.actualHours))) throw new BusinessError("Actual hours are required to complete a task");
    if (task.status === input.status) throw new BusinessError("Task status is unchanged");
    if (!canTransitionTaskStatus(task.status, input.status)) throw new BusinessError(`Invalid task status transition: ${task.status} -> ${input.status}`);
    const changed = await tx.task.updateMany({
      where: { id: task.id, status: task.status, ...(actor.role === "MEMBER" ? { assigneeId: input.actorId } : {}) },
      data: {
        status: input.status,
        ...(input.status === "DONE" ? { actualHours: input.actualHours, completedAt: new Date() } : {}),
      },
    });
    if (changed.count !== 1) throw new BusinessError("Task changed concurrently; retry the operation");
    const updated = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: task.projectId,
      action: "TASK_STATUS_CHANGED",
      entityType: "Task",
      entityId: task.id,
      before: { status: task.status, actualHours: task.actualHours?.toString() ?? null, completedAt: task.completedAt?.toISOString() ?? null },
      after: { status: updated.status, actualHours: updated.actualHours?.toString() ?? null, completedAt: updated.completedAt?.toISOString() ?? null },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return updated;
  });
}

export async function acceptWbsSuggestion(input: {
  suggestionId: string;
  actorId: string;
} & AuditRequestMetadata) {
  const projectId = await suggestionProjectId(input.suggestionId);
  return prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, input.actorId, ["PM"], projectId);
    const suggestion = await tx.aiSuggestion.findUnique({ where: { id: input.suggestionId } });
    if (!suggestion) throw new BusinessError("AI suggestion not found", 404);
    if (suggestion.type !== "WBS") throw new BusinessError("Suggestion is not a WBS task", 400);
    if (suggestion.status !== "PENDING") throw new BusinessError("AI suggestion has already been reviewed");

    const parsedOutput = acceptedWbsPayloadSchema.safeParse(suggestion.output);
    if (!parsedOutput.success) throw new BusinessError("WBS suggestion has an invalid task payload");
    const output = parsedOutput.data;
    const dependencySuggestions = output.dependencyIds.length === 0 ? [] : await tx.aiSuggestion.findMany({
      where: { id: { in: output.dependencyIds }, projectId: suggestion.projectId, type: "WBS" },
    });
    if (dependencySuggestions.length !== output.dependencyIds.length || dependencySuggestions.some(d => d.status !== "ACCEPTED")) {
      const byId = new Map(dependencySuggestions.map(d => [d.id, d]));
      throw new BusinessError(prerequisiteMessage(output.dependencyIds.map(id => {
        const dependency = byId.get(id);
        return { id, title: dependency ? suggestionTitle(dependency.output) : "未知前置任务", status: dependency?.status ?? "MISSING" };
      })));
    }
    const dependencyTaskIds = dependencySuggestions.flatMap((dependency) => {
      const dependencyOutput = acceptedWbsPayloadSchema.safeParse(dependency.output);
      return dependencyOutput.success && dependencyOutput.data.taskId ? [dependencyOutput.data.taskId] : [];
    });
    if (dependencyTaskIds.length !== output.dependencyIds.length) throw new BusinessError("An accepted prerequisite is missing its task record");

    const task = await tx.task.create({ data: {
      projectId: suggestion.projectId,
      title: output.title,
      description: output.description,
      estimateHours: output.estimateHours,
    } });
    if (dependencyTaskIds.length > 0) {
      await tx.taskDependency.createMany({ data: dependencyTaskIds.map((dependsOnTaskId) => ({ id: randomUUID(), taskId: task.id, dependsOnTaskId })) });
    }
    const reviewedAt = new Date();
    const changed = await tx.aiSuggestion.updateMany({
      where: { id: suggestion.id, status: "PENDING" },
      data: { status: "ACCEPTED", reviewedById: input.actorId, reviewedAt },
    });
    if (changed.count !== 1) throw new BusinessError("AI suggestion was reviewed concurrently; refresh and retry");
    const updatedOutput = { ...output, taskId: task.id } satisfies Prisma.InputJsonValue;
    const updated = await tx.aiSuggestion.update({ where: { id: suggestion.id }, data: { output: updatedOutput } });
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: suggestion.projectId,
      action: "TASK_CREATED",
      entityType: "Task",
      entityId: task.id,
      after: { title: task.title, status: task.status, estimateHours: task.estimateHours?.toString(), dependencies: dependencyTaskIds, aiSuggestionId: suggestion.id },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: suggestion.projectId,
      action: "AI_SUGGESTION_ACCEPTED",
      entityType: "AiSuggestion",
      entityId: suggestion.id,
      before: { status: suggestion.status },
      after: { status: updated.status, reviewedById: input.actorId, taskId: task.id },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { suggestion: updated, task };
  });
}

export async function assignTask(input: {
  taskId: string;
  assigneeId: string | null;
  actorId: string;
} & AuditRequestMetadata) {
  const projectId = await taskProjectId(input.taskId);
  return prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, input.actorId, ["PM"], projectId, input.assigneeId ? [input.assigneeId] : []);
    const task = await tx.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw new BusinessError("Task not found", 404);
    if (task.assigneeId === input.assigneeId) throw new BusinessError("Task assignee is unchanged");
    if (input.assigneeId && !await participant(tx, task.projectId, input.assigneeId)) throw new ProjectAccessError("负责人必须先加入项目", 400);
    const changed = await tx.task.updateMany({
      where: { id: task.id, assigneeId: task.assigneeId },
      data: { assigneeId: input.assigneeId },
    });
    if (changed.count !== 1) throw new BusinessError("Task changed concurrently; retry the operation");
    const updated = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: task.projectId,
      action: "TASK_ASSIGNED",
      entityType: "Task",
      entityId: task.id,
      before: { assigneeId: task.assigneeId },
      after: { assigneeId: updated.assigneeId },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return updated;
  });
}

export async function reviewAiSuggestion(input: {
  suggestionId: string;
  decision: "ACCEPTED" | "REJECTED";
  actorId: string;
} & AuditRequestMetadata) {
  const projectId = await suggestionProjectId(input.suggestionId);
  return prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, input.actorId, ["PM"], projectId);
    const suggestion = await tx.aiSuggestion.findUnique({ where: { id: input.suggestionId } });
    if (!suggestion) throw new BusinessError("AI suggestion not found", 404);
    if (suggestion.type !== "WBS") throw new BusinessError("Suggestion is not a WBS task", 400);
    if (suggestion.status !== "PENDING") throw new BusinessError("AI suggestion has already been reviewed");
    const reviewedAt = new Date();
    const changed = await tx.aiSuggestion.updateMany({
      where: { id: suggestion.id, status: "PENDING" },
      data: { status: input.decision, reviewedById: input.actorId, reviewedAt },
    });
    if (changed.count !== 1) throw new BusinessError("AI suggestion was reviewed concurrently; refresh and retry");
    const updated = await tx.aiSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: suggestion.projectId,
      action: input.decision === "ACCEPTED" ? "AI_SUGGESTION_ACCEPTED" : "AI_SUGGESTION_REJECTED",
      entityType: "AiSuggestion",
      entityId: suggestion.id,
      before: { status: suggestion.status },
      after: { status: updated.status, reviewedById: input.actorId, suggestionId: suggestion.id },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return updated;
  });
}

export async function reviewRiskSuggestion(input: {
  suggestionId: string;
  decision: "HANDLED" | "IGNORED";
  actorId: string;
} & AuditRequestMetadata) {
  const projectId = await suggestionProjectId(input.suggestionId);
  return prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, input.actorId, ["PM"], projectId);
    const suggestion = await tx.aiSuggestion.findUnique({ where: { id: input.suggestionId } });
    if (!suggestion) throw new BusinessError("AI suggestion not found", 404);
    if (suggestion.type !== "RISK") throw new BusinessError("Suggestion is not a risk warning", 400);
    if (suggestion.status !== "PENDING") throw new BusinessError("Risk suggestion has already been reviewed");
    const status = input.decision === "HANDLED" ? "ACCEPTED" : "REJECTED";
    const reviewedAt = new Date();
    const changed = await tx.aiSuggestion.updateMany({
      where: { id: suggestion.id, type: "RISK", status: "PENDING" },
      data: { status, reviewedById: input.actorId, reviewedAt },
    });
    if (changed.count !== 1) throw new BusinessError("Risk suggestion was reviewed concurrently; refresh and retry");
    const updated = await tx.aiSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: suggestion.projectId,
      action: input.decision === "HANDLED" ? "AI_RISK_SUGGESTION_HANDLED" : "AI_RISK_SUGGESTION_IGNORED",
      entityType: "AiSuggestion",
      entityId: suggestion.id,
      before: { status: suggestion.status },
      after: { status: updated.status, decision: input.decision, reviewedById: input.actorId },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return updated;
  });
}

/** Call before delivering an export so audit failure prevents an untracked export. */
export async function recordDataExport(input: {
  actorId: string;
  exportId: string;
  projectId?: string | null;
  scope: Prisma.InputJsonValue;
} & AuditRequestMetadata) {
  return prisma.$transaction((tx) => recordAudit(tx, {
    actorId: input.actorId,
    projectId: input.projectId,
    action: "DATA_EXPORTED",
    entityType: "DataExport",
    entityId: input.exportId,
    after: { scope: input.scope, exportedAt: new Date().toISOString() },
    ip: input.ip,
    userAgent: input.userAgent,
  }));
}

/** Persist retrieval provenance before the caller uses RAG results in an AI response. */
export async function recordRagSearch(input: {
  actorId: string;
  projectId: string;
  query: string;
  hitIds: string[];
  durationMs: number;
  degraded: boolean;
} & AuditRequestMetadata) {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) throw new BusinessError("Invalid RAG duration");
  const queryLogId = randomUUID();
  return prisma.$transaction((tx) => recordAudit(tx, {
    actorId: input.actorId,
    projectId: input.projectId,
    action: "RAG_SEARCH",
    entityType: "RagQuery",
    entityId: queryLogId,
    after: { query: input.query, hitIds: input.hitIds, durationMs: input.durationMs, degraded: input.degraded },
    ip: input.ip,
    userAgent: input.userAgent,
  }));
}
