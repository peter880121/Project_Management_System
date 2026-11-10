import { assertTaskWritable, assertTaskVersion, taskCancelSchema } from "@/modules/tasks/lifecycle";
import { prepareMeetingTask, type MeetingTaskSource } from "@/modules/tasks/meeting-source";
import { taskPlanData, calendarDateTime, effortHoursSchema, phaseSchema } from "@/modules/tasks/plan";
import { createTaskSchema } from "@/modules/tasks/create-schema";
import { taskPhase } from "@/modules/projects/task-phases";
import { randomUUID } from "node:crypto";
import type { Prisma, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canTransitionTaskStatus } from "@/modules/tasks/status";
import { assertProjectAccessTx, participant, ProjectAccessError, lockBusinessActor } from "@/modules/auth/project-access";
import { taskCompletionSchema } from "@/modules/tasks/signature";
import { verifyPassword } from "@/modules/auth/password";
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
  | "AUDIT_ISSUE_CHANGED" | "AUDIT_ISSUE_DETECTED" | "AUDIT_REPORT_EXPORTED"
  | "DECISION_SNAPSHOT_CAPTURED"
  | "WEEKLY_REPORT_REVISION_STARTED"
  | "WEEKLY_REPORT_DRAFTED" | "WEEKLY_REPORT_UPDATED" | "WEEKLY_REPORT_SUBMITTED" | "WEEKLY_REPORT_READ" | "WEEKLY_REPORT_RETURNED" | "WEEKLY_REPORT_EXEMPTED"
  | "REQUIREMENT_WORKFLOW_CHANGED" | "REQUIREMENT_INTAKE_CREATED" | "REQUIREMENT_INTAKE_TRIAGED" | "REQUIREMENT_BASELINE_CREATED" | "REQUIREMENT_IMAGE_UPLOADED"
  | "RAG_WEB_SEARCH_CONFIRMED" | "RAG_WEB_SEARCH_STARTED"
  | "RAG_CONVERSATION_CREATED" | "RAG_CONVERSATION_UPDATED" | "RAG_QUESTION_SUBMITTED" | "RAG_ANSWER_COMPLETED" | "RAG_ANSWER_STOPPED" | "RAG_ANSWER_FAILED"
  | "MEETING_ATTACHMENT_ADDED"
  | "PROJECT_DETAILS_UPDATED" | "PROJECT_OWNER_TRANSFERRED" | "TASK_DETAILS_UPDATED"
  | "PROJECT_PAUSED" | "PROJECT_RESUMED" | "PROJECT_CANCELLED"
  | "PROJECT_ACTIVATED" | "PROJECT_SUBMITTED" | "PROJECT_QA_APPROVED" | "PROJECT_ARCHIVED" | "PROJECT_ACCEPTANCE_REJECTED" | "PROJECT_ACCEPTANCE_WITHDRAWN" | "PROJECT_NOTIFICATION_READ"
  | "DELIVERABLE_CREATED" | "DELIVERABLE_UPDATED" | "DELIVERABLE_SUBMITTED" | "DELIVERABLE_REVIEWED"
  | "MEETING_CREATED" | "ASSET_INDEX_REQUESTED" | "ASSET_SOURCE_SYNCED" | "ASSET_SOURCE_FAILED" | "TASK_DELIVERABLE_REQUIREMENT_CHANGED"
  | "PROJECT_COMPLIANCE_CHECKED" | "PROJECT_ACCEPTANCE_OVERRIDE_SUBMITTED" | "ACCEPTANCE_OVERRIDE_PERMISSION_CHANGED" | "AI_ACCEPTANCE_DIAGNOSIS_GENERATED"
  | "AI_GENERATION_CANCELLED" | "AI_MEETING_GENERATED" | "AI_MEETING_GENERATION_FAILED" | "MEETING_UPDATED" | "MEETING_FINALIZED" | "MEETING_ACTION_ITEM_CONVERTED"
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
  | "TASK_CANCELLED" | "TASK_REOPENED" | "TASK_DEPENDENCY_INVALIDATED"
  | "TASK_CREATED"
  | "TASK_STATUS_CHANGED"
  | "TASK_SIGNED_AND_COMPLETED"
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
  estimateHours: effortHoursSchema,
  suggestedRole: z.enum(["PM", "MEMBER", "QA", "ADMIN"]),
  dependencyIds: z.array(z.uuid()).max(30),
  dependencyTitles: z.array(z.string()).max(30),
  sourceChunkIds: z.array(z.uuid()).max(4).optional(),
  taskId: z.uuid().optional(),
}).strict();

export async function createTask(input: {
  requiresDeliverable?: boolean;
  assigneeId?: string;
  dueDate?: string | null;
  plannedStartDate?: string | null;
  phase: string;
  estimateHours: number;
  meetingSource?: MeetingTaskSource;
  projectId: string;
  title: string;
  description?: string;
  requirementId?: string;
  actorId: string;
} & AuditRequestMetadata) {
  const parsed = createTaskSchema.safeParse({ title: input.title, description: input.description, phase: input.phase, estimateHours: input.estimateHours, dueDate: input.dueDate, plannedStartDate: input.plannedStartDate, requiresDeliverable: input.requiresDeliverable, assigneeId: input.assigneeId, requirementId: input.requirementId, meetingSource: input.meetingSource });
  if (!parsed.success) throw new BusinessError("请填写有效的预计工时、预计完成日期和所属阶段", 400);
  const plan = taskPlanData(parsed.data, input.description);
  return prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, input.actorId, input.meetingSource ? ["PM"] : ["ADMIN", "PM"], input.projectId, input.assigneeId ? [input.assigneeId] : []);
    await assertProjectAccessTx(tx, input.actorId, input.projectId);
    const source = input.meetingSource ? await prepareMeetingTask(tx, input.projectId, input.meetingSource) : null;
    if (source?.existing) return source.existing;
    if (input.assigneeId) {
      const user = await tx.user.findUnique({ where: { id: input.assigneeId }, select: { status: true, isSystem: true } });
      if (!user || user.status !== "ACTIVE" || user.isSystem || !await participant(tx, input.projectId, input.assigneeId)) throw new BusinessError("请选择当前项目的有效成员", 400);
    }
    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    if (!project) throw new BusinessError("Project not found", 404);
    let managedRequirement = false;
    if (input.requirementId) {
      const requirement = await tx.requirement.findFirst({ where: { id: input.requirementId, projectId: input.projectId, OR: [{ managed: false }, { workflowState: { in: ["DRAFT", "APPROVED", "IMPLEMENTING"] } }] }, select: { id: true, managed: true } });
      if (!requirement) throw new BusinessError("Requirement not found in this project", 404);
      managedRequirement = requirement.managed;
    }
    const task = await tx.task.create({ data: {
      projectId: input.projectId,
      title: input.title,
      ...plan,
      completionRoundId: randomUUID(), signatureEvidenceVersion: 2,
      requirementId: input.requirementId,
      requiresDeliverable: input.requiresDeliverable ?? false,
      assigneeId: input.assigneeId,
    } });
    if (input.requirementId && managedRequirement) await tx.requirementTaskLink.create({ data: { projectId: input.projectId, requirementId: input.requirementId, taskId: task.id, createdById: input.actorId } });
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: input.projectId,
      action: "TASK_CREATED",
      entityType: "Task",
      entityId: task.id,
      after: { title: task.title, status: task.status, requirementId: task.requirementId, requiresDeliverable: task.requiresDeliverable, assigneeId: task.assigneeId, phase: parsed.data.phase, estimateHours: Number(task.estimateHours), plannedStartDate: task.plannedStartDate?.toISOString() ?? null, dueDate: task.dueDate?.toISOString() ?? null, planningStatus: task.planningStatus, completionRoundId: task.completionRoundId, rowVersion: task.rowVersion, signatureEvidenceVersion: task.signatureEvidenceVersion },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    if (source && input.meetingSource) {
      Object.assign(source.item, { taskId: task.id, convertedAt: new Date().toISOString(), convertedById: input.actorId });
      await tx.meetingRecord.update({ where: { id: source.meeting.id }, data: { actionItems: source.items, rowVersion: { increment: 1 } } });
      await recordAudit(tx, { ...input, action: "MEETING_ACTION_ITEM_CONVERTED", entityType: "MeetingRecord", entityId: source.meeting.id, after: { actionItemId: source.item.id, taskId: task.id, rowVersion: source.meeting.rowVersion + 1, visibilityExpansionConfirmed: true } });
      if ("suggestionId" in source.item && source.item.suggestionId) await recordAudit(tx, { ...input, action: "AI_SUGGESTION_ACCEPTED", entityType: "AiSuggestion", entityId: source.item.suggestionId, after: { actionItemId: source.item.id, taskId: task.id, adoption: "ACTION_ITEM_ONLY" } });
    }
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
  signaturePassword?: string;
  signatureReason?: string;
  actualHours?: number;
  completedAt?: string;
  expectedCompletionRoundId?: string | null;
  expectedRowVersion?: number;
  cancelReason?: string;
  actorId: string;
} & AuditRequestMetadata) {
  const projectId = await taskProjectId(input.taskId);
  return prisma.$transaction(async (tx) => {
    const actor = await lockBusinessActor(tx, input.actorId, ["ADMIN", "PM", "MEMBER"], projectId);
    await assertProjectAccessTx(tx, input.actorId, projectId);
    const task = await tx.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw new BusinessError("Task not found", 404);
    assertTaskWritable(task);
    if (actor.role === "MEMBER" && (task.assigneeId !== input.actorId || task.status === "DONE" || input.status === "CANCELLED")) throw new ProjectAccessError("成员只能执行本人任务，不能取消或重开任务");
    const reopening = task.status === "DONE" && ["TODO", "IN_PROGRESS"].includes(input.status);
    assertTaskVersion(task, input.expectedRowVersion, input.status === "CANCELLED" || reopening || input.status === "DONE" && task.signatureEvidenceVersion === 2);
    if (input.status === "CANCELLED") {
      if (!["PM", "ADMIN"].includes(actor.role)) throw new ProjectAccessError("仅 PM 或 ADMIN 可以取消任务");
      if (!taskCancelSchema.safeParse({ status: input.status, cancelReason: input.cancelReason, expectedRowVersion: input.expectedRowVersion }).success) throw new BusinessError("取消原因必填，须为 10～1000 字", 400);
    }
    if (actor.role === "MEMBER" && (task.assigneeId !== input.actorId || task.status === "DONE")) throw new ProjectAccessError("成员仅可更新本人负责且未完成的任务");
    if (input.status === "DONE" && !taskCompletionSchema.safeParse({ status: "DONE", actualHours: input.actualHours, completedAt: input.completedAt, signaturePassword: input.signaturePassword, signatureReason: input.signatureReason, expectedCompletionRoundId: input.expectedCompletionRoundId, expectedRowVersion: input.expectedRowVersion }).success) throw new BusinessError("请填写有效的实际完成日期、实际工时、签名密码和签名意图", 400);
    if (task.status === input.status) throw new BusinessError("Task status is unchanged");
    if (!canTransitionTaskStatus(task.status, input.status)) throw new BusinessError(`Invalid task status transition: ${task.status} -> ${input.status}`);
    if (["IN_PROGRESS", "DONE"].includes(input.status) && await tx.task.findFirst({ where: { id: task.id, dependencies: { some: { dependsOn: { status: "CANCELLED" } } } }, select: { id: true } })) throw new BusinessError("前置任务已被取消，请重新评估依赖", 409);
    const completionEvidence = input.status === "DONE" && task.requiresDeliverable ? await tx.deliverable.findFirst({ where: { taskId: task.id, projectId: task.projectId, status: "APPROVED", document: { storageStatus: "AVAILABLE" } }, orderBy: [{ reviewedAt: "desc" }, { id: "asc" }], select: { id: true, version: true, reviewedById: true, document: { select: { id: true, sha256: true } } } }) : null;
    if (input.status === "DONE" && task.requiresDeliverable && !completionEvidence) throw new BusinessError("请先上传并审批通过的交付物", 400);
    if (input.status === "DONE") {
      if (input.expectedCompletionRoundId !== undefined && input.expectedCompletionRoundId !== task.completionRoundId) throw new BusinessError("任务完成轮次已变化，请刷新后重新签署", 409);
      const credentials = await tx.user.findUnique({ where: { id: input.actorId }, select: { passwordHash: true } });
      if (!credentials?.passwordHash || !await verifyPassword(input.signaturePassword!, credentials.passwordHash)) {
        console.warn("TASK_SIGNATURE_REJECTED", { actorId: input.actorId, taskId: input.taskId, createdAt: new Date().toISOString() });
        throw new BusinessError("签名密码错误，请重新输入", 401);
      }
    }
    const changed = await tx.task.updateMany({
      where: { id: task.id, status: task.status, rowVersion: task.rowVersion, ...(actor.role === "MEMBER" ? { assigneeId: input.actorId } : {}) },
      data: {
        status: input.status,
        ...(input.status === "CANCELLED" ? { cancelReason: input.cancelReason!.trim(), cancelledAt: new Date(), cancelledById: input.actorId } : {}),
        ...(input.status === "DONE" ? { actualHours: input.actualHours, completedAt: calendarDateTime(input.completedAt!), completionRoundId: randomUUID(), signatureEvidenceVersion: 2 } : reopening ? { actualHours: null, completedAt: null, completionRoundId: null, signatureEvidenceVersion: 2 } : {}),
      },
    });
    if (changed.count !== 1) throw new BusinessError("Task changed concurrently; retry the operation");
    const updated = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      projectId: task.projectId,
      action: input.status === "CANCELLED" ? "TASK_CANCELLED" : reopening ? "TASK_REOPENED" : input.status === "DONE" ? "TASK_SIGNED_AND_COMPLETED" : "TASK_STATUS_CHANGED",
      entityType: "Task",
      entityId: task.id,
      before: { status: task.status, actualHours: task.actualHours?.toString() ?? null, completedAt: task.completedAt?.toISOString() ?? null, completionRoundId: task.completionRoundId, rowVersion: task.rowVersion, signatureEvidenceVersion: task.signatureEvidenceVersion },
      after: { ...(input.status === "DONE" ? { signatureReason: input.signatureReason!, requiresDeliverable: !!task.requiresDeliverable, completionEvidence } : {}), cancelReason: updated.cancelReason, cancelledAt: updated.cancelledAt?.toISOString() ?? null, cancelledById: updated.cancelledById, rowVersion: updated.rowVersion, signatureEvidenceVersion: updated.signatureEvidenceVersion, status: updated.status, actualHours: updated.actualHours === null ? null : Number(updated.actualHours), completedAt: updated.completedAt?.toISOString() ?? null, completionRoundId: updated.completionRoundId },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    if (input.status === "CANCELLED") {
      const dependents = await tx.taskDependency.findMany({ where: { dependsOnTaskId: task.id }, select: { taskId: true } });
      for (const dependent of dependents) await recordAudit(tx, { actorId: input.actorId, projectId, action: "TASK_DEPENDENCY_INVALIDATED", entityType: "Task", entityId: dependent.taskId, after: { cancelledPredecessorId: task.id, reason: input.cancelReason!.trim() }, ip: input.ip, userAgent: input.userAgent });
    }
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
    const provenance = suggestion.input && typeof suggestion.input === "object" && !Array.isArray(suggestion.input) ? suggestion.input.sourceTaskId : undefined;
    const sourceTaskId = typeof provenance === "string" ? provenance : undefined;
    const sourceTask = sourceTaskId ? await tx.task.findFirst({ where: { id: sourceTaskId, projectId: suggestion.projectId }, select: { id: true, description: true, status: true } }) : null;
    if (sourceTask) assertTaskWritable(sourceTask);
    if (sourceTaskId && !sourceTask) throw new BusinessError("来源任务已不存在", 409);
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

    if (dependencyTaskIds.length && await tx.task.count({ where: { id: { in: dependencyTaskIds }, status: "CANCELLED" } })) throw new BusinessError("前置任务已被取消，请重新评估依赖", 409);
    const phase = phaseSchema.safeParse(taskPhase(output.description) ?? taskPhase(sourceTask?.description) ?? "工作分解");
    if (!phase.success) throw new BusinessError("来源任务阶段无效，请先修正阶段再采纳", 400);
    const task = await tx.task.create({ data: {
      projectId: suggestion.projectId,
      title: output.title,
      ...taskPlanData({ phase: phase.data, estimateHours: output.estimateHours, dueDate: null, plannedStartDate: null }, output.description),
      completionRoundId: randomUUID(), signatureEvidenceVersion: 2,
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
      after: { title: task.title, status: task.status, estimateHours: task.estimateHours?.toString(), planningStatus: task.planningStatus, dueDate: null, plannedStartDate: null, phase: taskPhase(task.description), dependencies: dependencyTaskIds, aiSuggestionId: suggestion.id, ...(sourceTaskId ? { sourceTaskId } : {}) },
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
  expectedRowVersion?: number;
  actorId: string;
} & AuditRequestMetadata) {
  const projectId = await taskProjectId(input.taskId);
  return prisma.$transaction(async (tx) => {
    await lockBusinessActor(tx, input.actorId, ["PM"], projectId, input.assigneeId ? [input.assigneeId] : []);
    const task = await tx.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw new BusinessError("Task not found", 404);
    await assertProjectAccessTx(tx, input.actorId, projectId);
    assertTaskWritable(task); assertTaskVersion(task, input.expectedRowVersion);
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
