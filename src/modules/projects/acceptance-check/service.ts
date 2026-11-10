import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { lockBusinessActor, assertProjectAccessTx, ProjectAccessError } from "@/modules/auth/project-access";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { ProjectError } from "../services";
import { countsSchema, gapCount, STALE_CHECK_MESSAGE, type CheckResult } from "./types";
import { evidenceFingerprint, readCounts } from "./repository";
export class CheckExpiredError extends ProjectError { readonly code = "CHECK_STALE"; constructor() { super(STALE_CHECK_MESSAGE, 409); } }
export class CheckGapsError extends ProjectError { readonly code = "COMPLIANCE_GAPS"; constructor() { super("不能提交验收：存在合规缺口，请先整改或使用已授权的风险提交流程", 400); } }
export function checkDto(row: { id: string; passed: boolean; counts: unknown; fingerprint: string }): CheckResult {
  const counts = countsSchema.parse(row.counts);
  return { checkId: row.id, passed: row.passed, counts, totalGaps: gapCount(counts), fingerprint: row.fingerprint, message: row.passed ? "合规检查通过，可提交验收" : "存在合规缺口，当前不可正常提交验收" };
}
export async function currentRules(tx: Prisma.TransactionClient, projectId: string) {
  const counts = await readCounts(tx, projectId); const fingerprint = await evidenceFingerprint(tx, projectId);
  return { counts, fingerprint, passed: gapCount(counts) === 0 };
}
export async function assertCheckFresh(tx: Prisma.TransactionClient, projectId: string, checkId: string, actorId: string, current: Awaited<ReturnType<typeof currentRules>>, projectVersion: number) {
  const row = await tx.projectComplianceCheck.findFirst({ where: { id: checkId, projectId, actorId } });
  if (!row) throw new ProjectAccessError("体检记录不存在或无权使用");
  if (row.ruleVersion !== 1 || row.projectVersion !== projectVersion || row.fingerprint !== current.fingerprint || JSON.stringify(countsSchema.parse(row.counts)) !== JSON.stringify(current.counts)) throw new CheckExpiredError();
  return row;
}
export async function createComplianceCheck(projectId: string, id: string, actor: { actorId: string } & AuditRequestMetadata) {
  return prisma.$transaction(async tx => {
    await lockBusinessActor(tx, actor.actorId, ["PM", "ADMIN"], projectId); await assertProjectAccessTx(tx, actor.actorId, projectId);
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    if (project.status !== "ACTIVE") throw new ProjectError("仅进行中的项目可执行结项前置体检", 409);
    const rules = await currentRules(tx, projectId);
    const collision = await tx.aiSuggestion.findUnique({ where: { id }, select: { projectId: true, type: true } });
    if (collision && (collision.projectId !== projectId || collision.type !== "ACCEPTANCE_DIAGNOSIS")) throw new ProjectError("请求 ID 已用于其他 AI 生成", 409);
    const existing = await tx.projectComplianceCheck.findUnique({ where: { id } });
    if (existing) { await assertCheckFresh(tx, projectId, id, actor.actorId, rules, project.rowVersion); return existing; }
    const row = await tx.projectComplianceCheck.create({ data: { id, projectId, actorId: actor.actorId, projectVersion: project.rowVersion, ...rules } });
    await recordAudit(tx, { ...actor, projectId, action: "PROJECT_COMPLIANCE_CHECKED", entityType: "ProjectComplianceCheck", entityId: row.id, after: { passed: row.passed, counts: rules.counts, fingerprint: row.fingerprint, ruleVersion: 1, projectVersion: project.rowVersion } });
    return row;
  }, { isolationLevel: "ReadCommitted", timeout: 15000 });
}
