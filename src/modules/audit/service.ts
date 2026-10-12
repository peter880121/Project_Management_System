import { randomUUID } from "node:crypto";
import type { Prisma, Role, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canTransitionTaskStatus } from "@/modules/tasks/status";

export type AuditAction =
  | "TASK_CREATED"
  | "TASK_STATUS_CHANGED"
  | "TASK_ASSIGNED"
  | "PERMISSION_CHANGED"
  | "DATA_EXPORTED"
  | "AI_SUGGESTION_ACCEPTED"
  | "AI_SUGGESTION_REJECTED"
  | "RAG_SEARCH";

export async function createTask(input: {
  projectId: string;
  title: string;
  description?: string;
  requirementId?: string;
  actorId: string;
} & AuditRequestMetadata) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    if (!project) throw new Error("Project not found");
    if (input.requirementId) {
      const requirement = await tx.requirement.findFirst({ where: { id: input.requirementId, projectId: input.projectId }, select: { id: true } });
      if (!requirement) throw new Error("Requirement not found in this project");
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
  actorId: string;
} & AuditRequestMetadata) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw new Error("Task not found");
    if (task.status === input.status) throw new Error("Task status is unchanged");
    if (!canTransitionTaskStatus(task.status, input.status)) throw new Error(`Invalid task status transition: ${task.status} -> ${input.status}`);
    const changed = await tx.task.updateMany({
      where: { id: task.id, status: task.status },
      data: { status: input.status },
    });
    if (changed.count !== 1) throw new Error("Task changed concurrently; retry the operation");
    const updated = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: task.projectId,
      action: "TASK_STATUS_CHANGED",
      entityType: "Task",
      entityId: task.id,
      before: { status: task.status },
      after: { status: updated.status },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return updated;
  });
}

export async function assignTask(input: {
  taskId: string;
  assigneeId: string | null;
  actorId: string;
} & AuditRequestMetadata) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw new Error("Task not found");
    if (task.assigneeId === input.assigneeId) throw new Error("Task assignee is unchanged");
    const changed = await tx.task.updateMany({
      where: { id: task.id, assigneeId: task.assigneeId },
      data: { assigneeId: input.assigneeId },
    });
    if (changed.count !== 1) throw new Error("Task changed concurrently; retry the operation");
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

export async function changeUserRole(input: {
  userId: string;
  role: Role;
  actorId: string;
} & AuditRequestMetadata) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true } });
    if (!user) throw new Error("User not found");
    if (user.role === input.role) throw new Error("User role is unchanged");
    const changed = await tx.user.updateMany({
      where: { id: user.id, role: user.role },
      data: { role: input.role },
    });
    if (changed.count !== 1) throw new Error("User role changed concurrently; retry the operation");
    const updated = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "PERMISSION_CHANGED",
      entityType: "User",
      entityId: user.id,
      before: { role: user.role },
      after: { role: updated.role },
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
  return prisma.$transaction(async (tx) => {
    const suggestion = await tx.aiSuggestion.findUnique({ where: { id: input.suggestionId } });
    if (!suggestion) throw new Error("AI suggestion not found");
    if (suggestion.status !== "PENDING") throw new Error("AI suggestion has already been reviewed");
    const reviewedAt = new Date();
    const changed = await tx.aiSuggestion.updateMany({
      where: { id: suggestion.id, status: "PENDING" },
      data: { status: input.decision, reviewedById: input.actorId, reviewedAt },
    });
    if (changed.count !== 1) throw new Error("AI suggestion was reviewed concurrently; refresh and retry");
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
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) throw new Error("Invalid RAG duration");
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
