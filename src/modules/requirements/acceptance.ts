import type { Prisma } from "@prisma/client";
import { ProjectError } from "@/modules/projects/services";
import { evidenceHash } from "./services";

type Entry = { requirementId: string; version: number; revisionId: string; sha256: string };
/** Latest baseline is the full committed scope; raw/deferred intake is not a gate. */
export async function requirementAcceptance(tx: Prisma.TransactionClient, projectId: string) {
  const baseline = await tx.requirementBaseline.findFirst({ where: { projectId }, orderBy: { ordinal: "desc" } });
  const approved = await tx.requirement.count({ where: { projectId, managed: true, approvedVersion: { not: null }, workflowState: { not: "CANCELLED" } } });
  if (!baseline) return { enabled: approved > 0, gapCount: approved > 0 ? 1 : 0, baseline: null, requirements: [] };
  if (evidenceHash(baseline.entries) !== baseline.sha256 || !Array.isArray(baseline.entries)) throw new ProjectError("需求基线完整性校验失败", 409);
  const entries = baseline.entries as Entry[];
  if (!entries.length || entries.length > 200) throw new ProjectError("需求基线范围无效", 409);
  // Fixed query count: JSON_TABLE binds the baseline to MySQL, avoiding one
  // query per requirement or loading full test bodies into application memory.
  const ids = entries.map(e => e.requirementId);
  const [requirements, executions, decisions, readiness] = await Promise.all([
    tx.requirement.findMany({ where: { projectId, id: { in: ids }, managed: true }, select: { id: true, number: true, workflowState: true, dueDate: true, completedAt: true, rowVersion: true } }),
    tx.testExecution.findMany({ where: { projectId, revisionId: { in: entries.map(e => e.revisionId) } }, select: { id: true, requirementId: true }, orderBy: { id: "asc" }, take: 20001 }),
    tx.requirementDecision.findMany({ where: { projectId, requirementId: { in: ids }, action: { in: ["APPROVE", "CUSTOMER-CONFIRM", "CLOSE", "REQUEST-FIX", "CANCEL", "APPROVE-CANCEL"] } }, select: { id: true, requirementId: true, revisionNumber: true }, orderBy: { id: "asc" }, take: 10001 }),
    tx.$queryRaw<{ requirementId: string; passed: number | bigint }[]>`SELECT jt.requirementId,
      (r.workflowState='CLOSED' AND r.completedAt IS NOT NULL AND r.draftVersion IS NULL AND r.approvedVersion=jt.version AND v.sha256=jt.sha256 COLLATE utf8mb4_unicode_ci
       AND EXISTS(SELECT 1 FROM Task t WHERE t.projectId=${projectId} AND t.status<>'CANCELLED' AND (t.requirementId=r.id OR EXISTS(SELECT 1 FROM RequirementTaskLink l WHERE l.taskId=t.id AND l.requirementId=r.id)))
       AND NOT EXISTS(SELECT 1 FROM Task t WHERE t.projectId=${projectId} AND t.status NOT IN ('DONE','CANCELLED') AND (t.requirementId=r.id OR EXISTS(SELECT 1 FROM RequirementTaskLink l WHERE l.taskId=t.id AND l.requirementId=r.id)))
       AND EXISTS(SELECT 1 FROM TestCase t WHERE t.requirementId=r.id)
       AND NOT EXISTS(SELECT 1 FROM TestCase t WHERE t.requirementId=r.id AND COALESCE((SELECT IF(e.testCaseSha256=SHA2(t.title,256) AND d.storageStatus='AVAILABLE' AND d.sha256=e.documentSha256,e.result,'INVALID') FROM TestExecution e LEFT JOIN Document d ON d.id=e.documentId WHERE e.testCaseId=t.id AND e.revisionId=v.id ORDER BY e.createdAt DESC,e.id DESC LIMIT 1),'NOT_RUN')<>'PASSED')
       AND EXISTS(SELECT 1 FROM RequirementDecision d WHERE d.requirementId=r.id AND d.revisionNumber=jt.version AND d.action='CLOSE')
       OR (r.workflowState='CANCELLED' AND r.approvedVersion=jt.version AND v.sha256=jt.sha256 COLLATE utf8mb4_unicode_ci AND EXISTS(SELECT 1 FROM RequirementDecision d WHERE d.requirementId=r.id AND d.revisionNumber=jt.version AND d.action='APPROVE-CANCEL'))
      ) passed FROM JSON_TABLE(${JSON.stringify(entries)}, '$[*]' COLUMNS(requirementId CHAR(36) PATH '$.requirementId', version INT PATH '$.version', revisionId CHAR(36) PATH '$.revisionId', sha256 CHAR(64) PATH '$.sha256')) jt
      LEFT JOIN Requirement r ON r.id=jt.requirementId COLLATE utf8mb4_unicode_ci AND r.projectId=${projectId} AND r.managed=TRUE
      LEFT JOIN RequirementRevision v ON v.id=jt.revisionId COLLATE utf8mb4_unicode_ci AND v.requirementId=r.id AND v.version=jt.version`,
  ]);
  if (executions.length > 20000 || decisions.length > 10000) throw new ProjectError("需求证据超过当前验收范围，请拆分交付批次", 422);
  const evidence = entries.map(entry => {
    const requirement = requirements.find(r => r.id === entry.requirementId);
    return { requirementId: entry.requirementId, version: entry.version, revisionId: entry.revisionId, sha256: entry.sha256, number: requirement?.number ?? null, state: requirement?.workflowState ?? "MISSING", rowVersion: requirement?.rowVersion ?? null, dueDate: requirement?.dueDate?.toISOString() ?? null, completedAt: requirement?.completedAt?.toISOString() ?? null, executionIds: executions.filter(e => e.requirementId === entry.requirementId).map(e => e.id), decisionIds: decisions.filter(d => d.requirementId === entry.requirementId && d.revisionNumber === entry.version).map(d => d.id), passed: Number(readiness.find(r => r.requirementId === entry.requirementId)?.passed ?? 0) === 1 };
  });
  const unscoped = await tx.requirement.findMany({ where: { projectId, managed: true, approvedVersion: { not: null }, workflowState: { not: "CANCELLED" }, id: { notIn: ids } }, select: { id: true, number: true, approvedVersion: true, workflowState: true, rowVersion: true, dueDate: true, completedAt: true }, take: 1001 });
  if (unscoped.length > 1000) throw new ProjectError("未纳入基线的需求超过范围，请拆分交付项目", 422);
  const scopedEvidence = [...evidence, ...unscoped.map(r => ({ requirementId: r.id, version: r.approvedVersion!, revisionId: null, sha256: null, number: r.number, state: r.workflowState, rowVersion: r.rowVersion, dueDate: r.dueDate?.toISOString() ?? null, completedAt: r.completedAt?.toISOString() ?? null, executionIds: [] as string[], decisionIds: [] as string[], passed: false }))];
  return { enabled: true, gapCount: scopedEvidence.filter(e => !e.passed).length, baseline: { id: baseline.id, name: baseline.name, sha256: baseline.sha256 }, requirements: scopedEvidence };
}
