import { createHash } from "node:crypto";
import type { Prisma, Role } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertProjectAccessTx, lockBusinessActor, participant, ProjectAccessError } from "@/modules/auth/project-access";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { verifyPassword } from "@/modules/auth/password";
import { calendarDateTime } from "@/modules/tasks/plan";
import { ProjectError } from "@/modules/projects/services";
import { actionSchema, baselineSchema, createRequirementSchema, editRequirementSchema, intakeActionSchema, intakeSchema, reasonSchema, type RequirementOperation } from "./schemas";
import { attachRequirementTask } from "./task-links";

type Actor = { actorId: string } & AuditRequestMetadata;
type Fields = z.infer<typeof editRequirementSchema>;
type Tx = Prisma.TransactionClient;
const managers: Role[] = ["PM", "ADMIN"];
const reviewers: Role[] = ["QA", "ADMIN"];
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const evidenceHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export async function lockRequirementActor(tx: Tx, projectId: string, actor: Actor, roles: Role[], related: string[] = []) {
  const user = await lockBusinessActor(tx, actor.actorId, roles, projectId, related);
  await assertProjectAccessTx(tx, actor.actorId, projectId); return user;
}
async function assertOwner(tx: Tx, projectId: string, ownerId: string | null) {
  if (ownerId && (!await participant(tx, projectId, ownerId) || !await tx.user.count({ where: { id: ownerId, status: "ACTIVE", isSystem: false } }))) throw new ProjectError("负责人必须是本项目有效成员", 400);
}
function metadata(fields: z.infer<typeof createRequirementSchema> | Fields) {
  return { ownerId: fields.ownerId, priority: fields.priority, category: fields.category, riskLevel: fields.riskLevel, discoveryPhase: fields.discoveryPhase, targetRelease: fields.targetRelease };
}
async function insertRevision(tx: Tx, projectId: string, requirementId: string, version: number, fields: z.infer<typeof createRequirementSchema> | Fields, actor: Actor) {
  const evidence = { title: fields.title, content: fields.content, acceptanceCriteria: fields.acceptanceCriteria, dueDate: fields.dueDate, metadata: metadata(fields) };
  return tx.requirementRevision.create({ data: { projectId, requirementId, version, title: fields.title, content: fields.content, acceptanceCriteria: fields.acceptanceCriteria, dueDate: calendarDateTime(fields.dueDate), metadata: evidence.metadata, sha256: evidenceHash(evidence), createdById: actor.actorId } });
}
async function decision(tx: Tx, projectId: string, id: string, version: number, action: string, comment: string, requestKey: string, actor: Actor, evidence: Prisma.InputJsonValue = {}) {
  const row = await tx.requirementDecision.create({ data: { projectId, requirementId: id, revisionNumber: version, action, comment, requestKey, actorId: actor.actorId, evidence } });
  const fromState = (evidence as Prisma.InputJsonObject).fromState;
  await recordAudit(tx, { ...actor, projectId, action: action === "CREATE" ? "REQUIREMENT_CREATED" : "REQUIREMENT_WORKFLOW_CHANGED", entityType: "Requirement", entityId: id, ...(typeof fromState === "string" ? { before: { workflowState: fromState } } : {}), after: { action, revisionNumber: version, decisionId: row.id, comment, evidence } }); return row;
}
export async function createRequirement(projectId: string, raw: unknown, actor: Actor) {
  const input = createRequirementSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await lockRequirementActor(tx, projectId, actor, managers, input.ownerId ? [input.ownerId] : []);
    const previous = await tx.requirementDecision.findUnique({ where: { projectId_requestKey: { projectId, requestKey: input.requestKey } } });
    if (previous) {
      if (previous.action !== "CREATE" || previous.actorId !== actor.actorId) throw new ProjectError("请求标识已用于其他操作", 409);
      return tx.requirement.findUniqueOrThrow({ where: { id: previous.requirementId } });
    }
    await assertOwner(tx, projectId, input.ownerId);
    const intake = input.intakeId ? await tx.requirementIntake.findFirst({ where: { id: input.intakeId, projectId, state: { in: ["SUBMITTED", "CLARIFYING", "DEFERRED"] } } }) : null;
    if (input.intakeId && !intake) throw new ProjectError("诉求已处理或不属于当前项目", 409);
    // The existing project lock serializes numbering, including concurrent creates.
    const count = await tx.requirement.count({ where: { projectId, managed: true } });
    const row = await tx.requirement.create({ data: { projectId, number: `REQ-${String(count + 1).padStart(4, "0")}`, managed: true, title: input.title, content: input.content, draftVersion: 1, createdById: actor.actorId, dueDate: calendarDateTime(input.dueDate), ...metadata(input) } });
    const revision = await insertRevision(tx, projectId, row.id, 1, input, actor);
    if (intake) await tx.requirementIntake.update({ where: { id: intake.id }, data: { state: "CONVERTED", requirementId: row.id, rowVersion: { increment: 1 } } });
    await decision(tx, projectId, row.id, 1, "CREATE", "建立需求草稿", input.requestKey, actor, { revisionId: revision.id, dueDate: input.dueDate, ...(intake ? { intakeId: intake.id } : {}) });
    return row;
  }, { timeout: 15000 });
}
export async function editRequirement(projectId: string, id: string, raw: unknown, actor: Actor) {
  const input = editRequirementSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await lockRequirementActor(tx, projectId, actor, managers, input.ownerId ? [input.ownerId] : []); await assertOwner(tx, projectId, input.ownerId);
    const old = await tx.requirement.findFirst({ where: { id, projectId, managed: true } });
    if (!old) throw new ProjectError("需求不存在或属于历史只读记录", 404);
    if (old.rowVersion !== input.expectedRowVersion) throw new ProjectError("需求已变化，请刷新后重试", 409);
    if (old.workflowState !== "DRAFT") throw new ProjectError("仅草稿可编辑；已批准需求请先发起变更", 409);
    const last = await tx.requirementRevision.findFirstOrThrow({ where: { requirementId: id }, orderBy: { version: "desc" } });
    const revision = await insertRevision(tx, projectId, id, last.version + 1, input, actor);
    const row = await tx.requirement.update({ where: { id }, data: { draftVersion: revision.version, rowVersion: { increment: 1 }, ...(!old.approvedVersion ? { title: input.title, content: input.content, dueDate: calendarDateTime(input.dueDate), ...metadata(input) } : {}) } });
    await recordAudit(tx, { ...actor, projectId, action: "REQUIREMENT_UPDATED", entityType: "Requirement", entityId: id, before: { draftVersion: old.draftVersion, rowVersion: old.rowVersion }, after: { draftVersion: revision.version, revisionId: revision.id, sha256: revision.sha256, dueDate: input.dueDate } }); return row;
  }, { timeout: 15000 });
}
async function usableDocument(tx: Tx, projectId: string, documentId?: string) {
  if (!documentId) throw new ProjectError("请关联本项目的验证或客户确认文档", 400);
  const doc = await tx.document.findFirst({ where: { id: documentId, projectId, storageStatus: "AVAILABLE", sha256: { not: null }, meetingAttachmentId: null, documentType: { not: "MEETING" } } });
  if (!doc) throw new ProjectError("证据文档不存在或不可用", 400); return doc;
}
async function assertVerified(tx: Tx, projectId: string, id: string, version: number) {
  const revision = await tx.requirementRevision.findUniqueOrThrow({ where: { requirementId_version: { requirementId: id, version } } });
  const cases = await tx.testCase.findMany({ where: { requirementId: id }, select: { id: true }, take: 1001 });
  if (!cases.length || cases.length > 1000) throw new ProjectError("请建立测试用例；单个需求最多支持 1000 个用例", 400);
  // SQL chooses the most recent immutable execution of every case for THIS revision.
  const [failed] = await tx.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) total FROM TestCase t WHERE t.requirementId=${id} AND COALESCE((SELECT IF(e.testCaseSha256=SHA2(t.title,256) AND d.storageStatus='AVAILABLE' AND d.sha256=e.documentSha256,e.result,'INVALID') FROM TestExecution e LEFT JOIN Document d ON d.id=e.documentId WHERE e.testCaseId=t.id AND e.revisionId=${revision.id} ORDER BY e.createdAt DESC,e.id DESC LIMIT 1),'NOT_RUN') <> 'PASSED'`;
  if (Number(failed.total)) throw new ProjectError("当前批准版本仍有测试未执行或未通过，请重新验证", 400);
  const tasks = await tx.task.findMany({ where: { projectId, OR: [{ requirementId: id }, { requirementLinks: { some: { requirementId: id } } }] }, select: { id: true, status: true }, take: 1001 });
  if (!tasks.some(t => t.status !== "CANCELLED") || tasks.length > 1000 || tasks.some(t => !["DONE", "CANCELLED"].includes(t.status))) throw new ProjectError("请完成关联的实施任务后再确认验证", 400);
  if (await tx.task.count({ where: { id: { in: tasks.filter(t => t.status !== "CANCELLED").map(t => t.id) }, requiresDeliverable: true, deliverables: { none: { status: "APPROVED", document: { storageStatus: "AVAILABLE", sha256: { not: null } } } } } })) throw new ProjectError("关联任务缺少已批准交付物", 400);
  return revision;
}
export async function actOnRequirement(projectId: string, id: string, operation: RequirementOperation, raw: unknown, actor: Actor) {
  const input = actionSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const role = await lockRequirementActor(tx, projectId, actor, ["approve", "return", "approve-cancel", "return-cancel", "record-test", "confirm-verification"].includes(operation) ? reviewers : operation === "comment" ? ["PM", "QA", "MEMBER", "ADMIN"] : managers);
    const old = await tx.requirement.findFirst({ where: { id, projectId, managed: true } });
    if (!old) throw new ProjectError("需求不存在或属于历史只读记录", 404);
    const prior = await tx.requirementDecision.findUnique({ where: { projectId_requestKey: { projectId, requestKey: input.requestKey } } });
    if (prior) { if (prior.requirementId !== id || prior.action !== operation.toUpperCase() || prior.actorId !== actor.actorId) throw new ProjectError("请求标识已使用", 409); return old; }
    if (old.rowVersion !== input.expectedRowVersion) throw new ProjectError("需求已变化，请刷新后重试", 409);
    if (old.workflowState === "CANCELLED" || old.workflowState === "CLOSED" && !["change", "comment"].includes(operation)) throw new ProjectError("需求已关闭或取消，不能执行此操作", 409);
    const revisionNumber = old.draftVersion ?? old.approvedVersion ?? old.version;
    let evidence: Prisma.InputJsonObject = {}; let data: Prisma.RequirementUpdateInput = { rowVersion: { increment: 1 } };
    const requireState = (...states: string[]) => { if (!states.includes(old.workflowState)) throw new ProjectError("需求状态已变化或当前操作不允许，请刷新", 409); };
    if (old.workflowState === "CANCEL_REVIEW" && !["approve-cancel", "return-cancel", "comment"].includes(operation)) throw new ProjectError("需求正在取消审批，其他操作已锁定", 409);
    if (["approve", "cancel"].includes(operation)) reasonSchema.parse(input.comment);
    if (operation === "submit") {
      requireState("DRAFT");
      const rev = await tx.requirementRevision.findUniqueOrThrow({ where: { requirementId_version: { requirementId: id, version: revisionNumber } } });
      const owner = (rev.metadata as { ownerId: string | null }).ownerId;
      if (!owner) throw new ProjectError("提交评审前请指定负责人", 400); await assertOwner(tx, projectId, owner);
      evidence = { revisionId: rev.id, sha256: rev.sha256 }; data = { ...data, workflowState: "IN_REVIEW", ...(!old.approvedVersion ? { status: "IN_REVIEW" } : {}) };
      await tx.requirementChangeRequest.updateMany({ where: { requirementId: id, state: "DRAFT" }, data: { state: "IN_REVIEW" } });
    } else if (operation === "approve" || operation === "return") {
      requireState("IN_REVIEW"); const submission = await tx.requirementDecision.findFirst({ where: { requirementId: id, action: "SUBMIT", revisionNumber }, orderBy: { createdAt: "desc" } });
      if (!submission || submission.actorId === actor.actorId) throw new ProjectAccessError("不能评审本人提交的需求版本");
      if (operation === "return") { reasonSchema.parse(input.comment); data = { ...data, workflowState: "DRAFT", ...(!old.approvedVersion ? { status: "DRAFT" } : {}) }; await tx.requirementChangeRequest.updateMany({ where: { requirementId: id, state: "IN_REVIEW" }, data: { state: "DRAFT" } }); }
      else {
        if (!input.signaturePassword) throw new ProjectError("批准需求必须输入签名密码", 400);
        const user = await tx.user.findUnique({ where: { id: actor.actorId }, select: { passwordHash: true } });
        if (!user?.passwordHash || !await verifyPassword(input.signaturePassword, user.passwordHash)) { console.warn("REQUIREMENT_SIGNATURE_PASSWORD_REJECTED"); throw new ProjectError("签名密码错误", 401); }
        const rev = await tx.requirementRevision.findUniqueOrThrow({ where: { requirementId_version: { requirementId: id, version: revisionNumber } } });
        const attachments = await tx.requirementAttachment.findMany({ where: { projectId, OR: [{ requirementId: id }, { intake: { requirementId: id } }] }, select: { id: true, sha256: true }, orderBy: { id: "asc" } });
        evidence = { revisionId: rev.id, sha256: rev.sha256, signatureReason: "批准需求及验收标准", attachments, previousVersion: old.approvedVersion };
        data = { ...data, workflowState: "APPROVED", status: "APPROVED", approvedVersion: revisionNumber, version: revisionNumber, draftVersion: null, title: rev.title, content: rev.content, dueDate: rev.dueDate, completedAt: null, ...rev.metadata as Prisma.InputJsonObject };
        await tx.requirementChangeRequest.updateMany({ where: { requirementId: id, state: "IN_REVIEW" }, data: { state: "APPROVED" } });
        // Existing traceability reviews are version-bound; old executions remain immutable.
        await tx.testCase.updateMany({ where: { requirementId: id }, data: { status: "NOT_RUN", reviewedRequirementVersion: null, requirementReviewedById: null, requirementReviewedAt: null } });
      }
    } else if (operation === "start") { requireState("APPROVED"); data.workflowState = "IMPLEMENTING";
    } else if (operation === "verify") { requireState("IMPLEMENTING"); data.workflowState = "VERIFYING";
    } else if (operation === "record-test") {
      requireState("VERIFYING"); if (!input.testCaseId || !input.result || !input.comment.trim()) throw new ProjectError("请填写测试用例、结果和验证说明", 400);
      const doc = await usableDocument(tx, projectId, input.documentId); const test = await tx.testCase.findFirst({ where: { id: input.testCaseId, requirementId: id } });
      if (!test) throw new ProjectError("测试用例不属于此需求", 400);
      const rev = await tx.requirementRevision.findUniqueOrThrow({ where: { requirementId_version: { requirementId: id, version: old.approvedVersion! } } });
      const result = await tx.testExecution.create({ data: { projectId, requirementId: id, revisionId: rev.id, testCaseId: test.id, testCaseSha256: createHash("sha256").update(test.title).digest("hex"), result: input.result, comment: input.comment, documentId: doc.id, documentSha256: doc.sha256!, actorId: actor.actorId } });
      await tx.testCase.update({ where: { id: test.id }, data: { status: input.result, reviewedRequirementVersion: old.approvedVersion, requirementReviewedById: actor.actorId, requirementReviewedAt: new Date() } });
      evidence = { executionId: result.id, documentId: doc.id, sha256: doc.sha256!, result: input.result };
    } else if (operation === "confirm-verification") { requireState("VERIFYING"); await assertVerified(tx, projectId, id, old.approvedVersion!); data.workflowState = "CUSTOMER_CONFIRMATION";
    } else if (operation === "customer-confirm") { requireState("CUSTOMER_CONFIRMATION"); reasonSchema.parse(input.comment); const doc = await usableDocument(tx, projectId, input.documentId); evidence = { documentId: doc.id, sha256: doc.sha256!, confirmationType: "EXTERNAL_EVIDENCE_REGISTERED", recordedById: actor.actorId };
    } else if (operation === "request-fix") { requireState("VERIFYING", "CUSTOMER_CONFIRMATION"); reasonSchema.parse(input.comment); data.workflowState = "IMPLEMENTING";
    } else if (operation === "close") {
      requireState("CUSTOMER_CONFIRMATION"); if (!input.completedAt) throw new ProjectError("请填写实际完成日期", 400);
      await assertVerified(tx, projectId, id, old.approvedVersion!);
      const confirmation = await tx.requirementDecision.findFirst({ where: { requirementId: id, revisionNumber: old.approvedVersion!, action: "CUSTOMER-CONFIRM" }, orderBy: { createdAt: "desc" } });
      const invalidation = await tx.requirementDecision.findFirst({ where: { requirementId: id, revisionNumber: old.approvedVersion!, action: "REQUEST-FIX" }, orderBy: { createdAt: "desc" } });
      if (!confirmation || invalidation && confirmation.createdAt <= invalidation.createdAt) throw new ProjectError("请先登记当前版本的客户确认凭证", 400);
      const confirmationEvidence = confirmation.evidence as { documentId: string; sha256: string };
      const confirmedDocument = await usableDocument(tx, projectId, confirmationEvidence.documentId);
      if (confirmedDocument.sha256 !== confirmationEvidence.sha256) throw new ProjectError("客户确认凭证已变化，请重新确认", 409);
      data = { ...data, workflowState: "CLOSED", completedAt: calendarDateTime(input.completedAt) }; evidence = { completedAt: input.completedAt, dueDate: old.dueDate?.toISOString() ?? null, confirmationId: confirmation.id };
    } else if (operation === "cancel") {
      if (old.approvedVersion && old.draftVersion) throw new ProjectError("请先撤回当前需求变更，再申请取消", 409);
      data = { ...data, workflowState: old.approvedVersion ? "CANCEL_REVIEW" : "CANCELLED", ...(!old.approvedVersion ? { status: "RETIRED" as const } : {}) }; evidence = { reason: input.comment, previousState: old.workflowState };
    } else if (operation === "approve-cancel" || operation === "return-cancel") {
      requireState("CANCEL_REVIEW"); reasonSchema.parse(input.comment);
      const request = await tx.requirementDecision.findFirst({ where: { requirementId: id, action: "CANCEL" }, orderBy: { createdAt: "desc" } });
      if (!request || request.actorId === actor.actorId) throw new ProjectAccessError("不能审批本人提交的取消申请");
      if (operation === "approve-cancel") {
        if (!input.signaturePassword) throw new ProjectError("批准取消必须输入签名密码", 400);
        const user = await tx.user.findUnique({ where: { id: actor.actorId }, select: { passwordHash: true } });
        if (!user?.passwordHash || !await verifyPassword(input.signaturePassword, user.passwordHash)) { console.warn("REQUIREMENT_SIGNATURE_PASSWORD_REJECTED"); throw new ProjectError("签名密码错误", 401); }
        data = { ...data, workflowState: "CANCELLED", status: "RETIRED" }; evidence = { cancellationRequestId: request.id, signatureReason: "批准取消需求" };
      } else data.workflowState = (request.evidence as { previousState: string }).previousState;
    } else if (operation === "withdraw-change") {
      requireState("DRAFT", "IN_REVIEW"); reasonSchema.parse(input.comment);
      const change = await tx.requirementChangeRequest.findFirst({ where: { requirementId: id, state: { in: ["DRAFT", "IN_REVIEW"] } }, orderBy: { createdAt: "desc" } });
      if (!change || !old.approvedVersion) throw new ProjectError("没有可撤回的需求变更", 409);
      await tx.requirementChangeRequest.update({ where: { id: change.id }, data: { state: "WITHDRAWN" } }); data = { ...data, workflowState: change.previousState, draftVersion: null }; evidence = { changeId: change.id };
    } else if (operation === "change") {
      requireState("APPROVED", "IMPLEMENTING", "VERIFYING", "CUSTOMER_CONFIRMATION", "CLOSED"); reasonSchema.parse(input.comment); if (!input.impact) throw new ProjectError("请填写范围、工期、成本和风险影响", 400);
      const priorRev = await tx.requirementRevision.findUniqueOrThrow({ where: { requirementId_version: { requirementId: id, version: old.approvedVersion! } } });
      const last = await tx.requirementRevision.findFirstOrThrow({ where: { requirementId: id }, orderBy: { version: "desc" } });
      const rev = await tx.requirementRevision.create({ data: { projectId, requirementId: id, version: last.version + 1, title: priorRev.title, content: priorRev.content, acceptanceCriteria: priorRev.acceptanceCriteria, dueDate: priorRev.dueDate, metadata: priorRev.metadata as Prisma.InputJsonValue, sha256: priorRev.sha256, createdById: actor.actorId } });
      const change = await tx.requirementChangeRequest.create({ data: { projectId, requirementId: id, fromVersion: old.approvedVersion!, previousState: old.workflowState, reason: input.comment, impact: input.impact, createdById: actor.actorId } });
      data = { ...data, workflowState: "DRAFT", draftVersion: rev.version }; evidence = { changeId: change.id, fromVersion: old.approvedVersion, draftVersion: rev.version, impact: input.impact };
    } else if (operation === "link-task") {
      requireState("DRAFT", "APPROVED", "IMPLEMENTING"); if (!input.taskId) throw new ProjectError("请选择任务", 400);
      const { task } = await attachRequirementTask(tx, projectId, id, input.taskId, actor.actorId);
      if (!task.requirementId) { await tx.task.update({ where: { id: task.id }, data: { requirementId: id, rowVersion: { increment: 1 } } }); await recordAudit(tx, { ...actor, projectId, action: "TASK_REQUIREMENT_CHANGED", entityType: "Task", entityId: task.id, before: { requirementId: null }, after: { requirementId: id } }); }
      evidence = { taskId: task.id };
    } else { if (!input.comment.trim()) throw new ProjectError("请填写沟通内容", 400); evidence = { role: role.role }; }
    const updated = await tx.requirement.update({ where: { id }, data });
    await decision(tx, projectId, id, revisionNumber, operation.toUpperCase(), input.comment, input.requestKey, actor, { fromState: old.workflowState, toState: updated.workflowState, ...evidence }); return updated;
  }, { isolationLevel: "ReadCommitted", timeout: 15000 });
}
export async function createIntake(projectId: string, raw: unknown, actor: Actor) {
  const input = intakeSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await lockRequirementActor(tx, projectId, actor, ["PM", "QA", "MEMBER", "ADMIN"]);
    const prior = await tx.requirementIntake.findUnique({ where: { projectId_requestKey: { projectId, requestKey: input.requestKey } } });
    if (prior) { if (prior.createdById !== actor.actorId) throw new ProjectError("请求标识已使用", 409); return prior; }
    const row = await tx.requirementIntake.create({ data: { ...input, projectId, createdById: actor.actorId } });
    await recordAudit(tx, { ...actor, projectId, action: "REQUIREMENT_INTAKE_CREATED", entityType: "RequirementIntake", entityId: row.id, after: { title: row.title, source: row.source, requester: row.requester } }); return row;
  });
}
export async function triageIntake(projectId: string, id: string, raw: unknown, actor: Actor) {
  const input = intakeActionSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await lockRequirementActor(tx, projectId, actor, managers);
    const old = await tx.requirementIntake.findFirst({ where: { id, projectId } });
    if (!old) throw new ProjectError("诉求不存在", 404);
    if (["CONVERTED", "REJECTED", "DUPLICATE"].includes(old.state) || old.rowVersion !== input.expectedRowVersion) throw new ProjectError("诉求已处理或已变化，请刷新", 409);
    if (input.state === "DUPLICATE" && (!input.requirementId || !await tx.requirement.count({ where: { id: input.requirementId, projectId } }))) throw new ProjectError("请关联本项目的已有需求", 400);
    const row = await tx.requirementIntake.update({ where: { id }, data: { state: input.state, reason: input.reason, ...(input.state === "DUPLICATE" ? { requirementId: input.requirementId } : {}), rowVersion: { increment: 1 } } });
    await recordAudit(tx, { ...actor, projectId, action: "REQUIREMENT_INTAKE_TRIAGED", entityType: "RequirementIntake", entityId: id, before: { state: old.state }, after: { state: row.state, reason: input.reason, requirementId: row.requirementId } }); return row;
  });
}
export async function createBaseline(projectId: string, raw: unknown, actor: Actor) {
  const input = baselineSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await lockRequirementActor(tx, projectId, actor, managers);
    const rows = await tx.requirement.findMany({ where: { projectId, id: { in: input.requirementIds }, managed: true, approvedVersion: { not: null }, draftVersion: null, workflowState: { notIn: ["DRAFT", "IN_REVIEW", "CANCELLED"] } }, orderBy: { id: "asc" } });
    if (rows.length !== input.requirementIds.length) throw new ProjectError("基线只能包含当前已批准、没有待审变更的需求", 400);
    const committedCount = await tx.requirement.count({ where: { projectId, managed: true, approvedVersion: { not: null }, workflowState: { not: "CANCELLED" } } });
    if (rows.length !== committedCount) throw new ProjectError("交付基线必须包含本项目全部已批准需求；不再交付的需求请先完成取消审批", 400);
    const entries = await Promise.all(rows.map(async r => { const revision = await tx.requirementRevision.findUniqueOrThrow({ where: { requirementId_version: { requirementId: r.id, version: r.approvedVersion! } } }); return { requirementId: r.id, number: r.number, version: revision.version, revisionId: revision.id, sha256: revision.sha256 }; }));
    const latest = await tx.requirementBaseline.findFirst({ where: { projectId }, orderBy: { ordinal: "desc" }, select: { ordinal: true } });
    const row = await tx.requirementBaseline.create({ data: { projectId, name: input.name, ordinal: (latest?.ordinal ?? 0) + 1, entries, sha256: evidenceHash(entries), createdById: actor.actorId } });
    await recordAudit(tx, { ...actor, projectId, action: "REQUIREMENT_BASELINE_CREATED", entityType: "RequirementBaseline", entityId: row.id, after: { name: row.name, sha256: row.sha256, entries } }); return row;
  });
}
