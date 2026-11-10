import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assertProjectAccessTx,
  participant,
} from "@/modules/auth/project-access";
import { lockProject, lockUsers } from "@/modules/auth/transaction-locks";
import { ProjectError } from "@/modules/projects/services";
import {
  canReadDocument,
  meetingAttachmentSelect,
} from "@/modules/documents/access";
import { recordAudit, type AuditRequestMetadata } from "./service";
import { issueCommandSchema, type IssueCommand } from "./issue-schema";
import { issueTransition } from "./issue-transition";
import { updateIssue } from "./issue-repositories";
import type { ComplianceFinding } from "@/modules/ai/compliance-audit/types";
import { loadComplianceSnapshot } from "@/modules/ai/compliance-audit/repositories";
import {
  findTraceabilityIssues,
  RULE_VERSION,
} from "@/modules/ai/compliance-audit/rules";
import { createHash } from "node:crypto";

export function findingFingerprint(
  finding: Pick<ComplianceFinding, "code" | "findingKey">,
) {
  return `${finding.code}:${finding.findingKey.split(":")[1]}`;
}
/** Scan results remain pending human review, never change formal task/requirement state. */
export async function registerScanIssues(
  tx: Prisma.TransactionClient,
  projectId: string,
  summaryId: string,
  findings: ComplianceFinding[],
  actor: { actorId: string } & AuditRequestMetadata,
) {
  const refs: { findingKey: string; issueId: string }[] = [];
  for (const finding of findings) {
    const fingerprint = findingFingerprint(finding);
    let issue = await tx.auditIssue.findUnique({
      where: { projectId_fingerprint: { projectId, fingerprint } },
    });
    if (!issue) {
      issue = await tx.auditIssue.create({
        data: {
          projectId,
          fingerprint,
          code: finding.code,
          title: finding.summary,
          severity:
            finding.code === "DONE_TASK_WITH_UNPASSED_TEST" ? "HIGH" : "MEDIUM",
        },
      });
      await recordAudit(tx, {
        ...actor,
        projectId,
        action: "AUDIT_ISSUE_DETECTED",
        entityType: "AuditIssue",
        entityId: issue.id,
        after: { summaryId, status: "PENDING", findingKey: finding.findingKey },
      });
    }
    await tx.auditIssueOccurrence.create({
      data: {
        issueId: issue.id,
        summaryId,
        findingKey: finding.findingKey,
        evidence: finding,
      },
    });
    refs.push({ findingKey: finding.findingKey, issueId: issue.id });
    // A later occurrence never silently closes/reopens a human decision. UI flags recurrence.
  }
  return refs;
}

type Actor = { actorId: string } & AuditRequestMetadata;
export async function changeIssue(
  id: string,
  command: IssueCommand,
  actor: Actor,
) {
  const parsed = issueCommandSchema.safeParse(command);
  if (!parsed.success)
    throw new ProjectError("请补全整改说明、负责人、日期或证据", 400);
  command = parsed.data;
  const scope = await prisma.auditIssue.findUnique({
    where: { id },
    select: { projectId: true },
  });
  if (!scope) throw new ProjectError("整改问题不存在", 404);
  // Current rule scan is deterministic; closure rechecks under a project lock below.
  return prisma.$transaction(
    async (tx) => {
      await lockProject(tx, scope.projectId);
      await lockUsers(tx, [
        actor.actorId,
        ...(command.assignedToId ? [command.assignedToId] : []),
      ]);
      await assertProjectAccessTx(tx, actor.actorId, scope.projectId);
      const user = await tx.user.findUnique({
        where: { id: actor.actorId },
        select: { role: true, isSystem: true, status: true },
      });
      if (!user || user.isSystem || user.status !== "ACTIVE")
        throw new ProjectError("账号不可执行整改操作", 403);
      const issue = await tx.auditIssue.findUniqueOrThrow({
        where: { id },
        include: {
          events: {
            where: { action: "SUBMIT" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
        },
      });
      if (issue.rowVersion !== command.expectedRowVersion)
        throw new ProjectError("问题已经更新，请刷新后重试", 409);
      const next = issueTransition(
        issue.status,
        command,
        user.role,
        issue.assignedToId === actor.actorId,
      );
      let assignedToName: string | undefined;
      if (command.action === "ASSIGN") {
        const assignee = await tx.user.findUnique({
          where: { id: command.assignedToId! },
          select: { name: true, role: true, status: true, isSystem: true },
        });
        if (
          !assignee ||
          assignee.status !== "ACTIVE" ||
          assignee.isSystem ||
          !["PM", "MEMBER"].includes(assignee.role) ||
          !(await participant(tx, issue.projectId, command.assignedToId!))
        )
          throw new ProjectError("请选择当前项目的有效项目经理或成员", 400);
        if (new Date(command.dueDate!).getTime() <= Date.now())
          throw new ProjectError("截止时间必须晚于当前时间", 400);
        assignedToName = assignee.name;
      }
      const documents = command.evidenceIds.length
        ? await tx.document.findMany({
            where: {
              id: { in: command.evidenceIds },
              projectId: issue.projectId,
              storageStatus: "AVAILABLE",
            },
            select: {
              id: true,
              filename: true,
              sha256: true,
              visibleRoles: true,
              projectId: true,
              meetingAttachment: { select: meetingAttachmentSelect },
            },
          })
        : [];
      if (
        documents.length !== new Set(command.evidenceIds).size ||
        documents.some(
          (doc) =>
            !canReadDocument(doc, user.role) || !canReadDocument(doc, "QA"),
        )
      )
        throw new ProjectError(
          "整改证据必须是当前项目内本人及 QA 可访问的有效文档",
          403,
        );
      if (
        documents.some(
          (doc) => !doc.sha256 || !/^[a-f0-9]{64}$/i.test(doc.sha256),
        )
      )
        throw new ProjectError("整改文档缺少有效校验值，请重新上传后提交", 400);
      let verification: Prisma.InputJsonValue | null = null;
      if (command.action === "CLOSE") {
        const submission = issue.events[0];
        if (!submission || submission.actorId === actor.actorId)
          throw new ProjectError("需由其他 QA 验证已提交的整改证据", 403);
        const evidence = submission.evidence as {
          documents?: { id: string; sha256: string | null }[];
        };
        if (!evidence.documents?.length)
          throw new ProjectError("缺少整改证据", 400);
        const currentDocs = await tx.document.findMany({
          where: {
            id: { in: evidence.documents.map((d) => d.id) },
            projectId: issue.projectId,
            storageStatus: "AVAILABLE",
          },
          select: {
            id: true,
            sha256: true,
            visibleRoles: true,
            projectId: true,
            meetingAttachment: { select: meetingAttachmentSelect },
          },
        });
        if (
          currentDocs.length !== evidence.documents.length ||
          currentDocs.some(
            (doc) =>
              !canReadDocument(doc, "QA") ||
              doc.sha256 !==
                evidence.documents!.find((d) => d.id === doc.id)?.sha256,
          )
        )
          throw new ProjectError("整改证据已变化或不可访问，请重新提交", 409);
        // Same transaction snapshot and project lock as the final state change.
        const snapshot = await loadComplianceSnapshot(
          { projectId: issue.projectId },
          tx,
        );
        if (!snapshot.coverage.complete)
          throw new ProjectError("检查覆盖不完整，无法关闭问题", 409);
        if (
          findTraceabilityIssues(snapshot.data).some(
            (f) => findingFingerprint(f) === issue.fingerprint,
          )
        )
          throw new ProjectError("当前规则复查仍发现该问题，请继续整改", 409);
        const businessSnapshot = JSON.parse(JSON.stringify(snapshot.data));
        verification = {
          ruleVersion: RULE_VERSION,
          verifiedAt: new Date().toISOString(),
          result: "PASSED",
          coverage: snapshot.coverage,
          submissionId: submission.id,
          businessSnapshot,
          snapshotSha256: createHash("sha256")
            .update(JSON.stringify(businessSnapshot))
            .digest("hex"),
        };
      }
      const updated = await updateIssue(tx, id, command.expectedRowVersion, {
        status: next,
        ...(command.action === "ASSIGN"
          ? {
              assignedToId: command.assignedToId,
              dueDate: new Date(command.dueDate!),
            }
          : {}),
        ...(command.severity && command.action === "CONFIRM"
          ? { severity: command.severity }
          : {}),
      });
      if (!updated.count) throw new ProjectError("问题已变化，请刷新", 409);
      const event = await tx.auditIssueEvent.create({
        data: {
          issueId: id,
          actorId: actor.actorId,
          action: command.action,
          fromStatus: issue.status,
          toStatus: next,
          note: command.note,
          evidence: {
            documents: documents.map((d) => ({
              id: d.id,
              filename: d.filename,
              sha256: d.sha256,
            })),
            verification,
            ...(command.action === "ASSIGN"
              ? {
                  assignedToId: command.assignedToId!,
                  assignedToName: assignedToName!,
                  dueDate: command.dueDate!,
                }
              : {}),
          },
        },
      });
      await recordAudit(tx, {
        ...actor,
        projectId: issue.projectId,
        action: "AUDIT_ISSUE_CHANGED",
        entityType: "AuditIssue",
        entityId: id,
        before: {
          severity: issue.severity,
          status: issue.status,
          assignedToId: issue.assignedToId,
          dueDate: issue.dueDate?.toISOString() ?? null,
        },
        after: {
          severity:
            command.action === "CONFIRM"
              ? (command.severity ?? issue.severity)
              : issue.severity,
          status: next,
          action: command.action,
          note: command.note,
          evidenceIds: command.evidenceIds,
          eventId: event.id,
          rowVersion: issue.rowVersion + 1,
          ...(command.action === "ASSIGN"
            ? { assignedToId: command.assignedToId, dueDate: command.dueDate }
            : {}),
        },
      });
      return { id, status: next };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30000,
    },
  );
}

export async function auditReport(actor: Actor, projectId: string) {
  return prisma.$transaction(
    async (tx) => {
      await lockProject(tx, projectId);
      await assertProjectAccessTx(tx, actor.actorId, projectId);
      const user = await tx.user.findUnique({
        where: { id: actor.actorId },
        select: { role: true },
      });
      if (!user || !["ADMIN", "QA"].includes(user.role))
        throw new ProjectError("仅管理员与 QA 可导出", 403);
      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { name: true },
      });
      const issues = await tx.auditIssue.findMany({
        where: { projectId },
        include: {
          assignedTo: { select: { name: true } },
          occurrences: true,
          events: {
            include: { actor: { select: { name: true } } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1001,
      });
      if (issues.length > 1000)
        throw new ProjectError(
          "问题超过单次报告上限，请缩小项目范围或联系管理员",
          400,
        );
      const payload = {
        projectId,
        projectName: project.name,
        exportedAt: new Date().toISOString(),
        actorId: actor.actorId,
        issues,
      };
      const sha256 = createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");
      await recordAudit(tx, {
        ...actor,
        projectId,
        action: "AUDIT_REPORT_EXPORTED",
        entityType: "Project",
        entityId: projectId,
        after: {
          scope: { projectId, issueIds: issues.map((i) => i.id) },
          format: "html",
          sha256,
          exportedAt: payload.exportedAt,
        },
      });
      return { ...payload, sha256 };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30000,
    },
  );
}
