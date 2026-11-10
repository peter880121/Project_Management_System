import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { completionRoundEvidence } from "@/modules/tasks/signature-evidence";
import { countsSchema, type CheckRule, type GapDetail } from "./types";
import { requirementAcceptance } from "@/modules/requirements/acceptance";

const validSignature = Prisma.sql`EXISTS (SELECT 1 FROM AuditLog a WHERE a.projectId=t.projectId AND a.entityType='Task' AND a.entityId=t.id AND a.action='TASK_SIGNED_AND_COMPLETED' AND JSON_UNQUOTE(JSON_EXTRACT(a.after,'$.status'))='DONE' AND JSON_TYPE(JSON_EXTRACT(a.after,'$.signatureReason'))='STRING' AND CHAR_LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(a.after,'$.signatureReason'))))>0 AND t.completedAt IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(a.after,'$.completedAt'))=CONCAT(DATE_FORMAT(t.completedAt,'%Y-%m-%dT%H:%i:%s.'),LPAD(FLOOR(MICROSECOND(t.completedAt)/1000),3,'0'),'Z') AND ${completionRoundEvidence})`;
const hasDeliverable = Prisma.sql`EXISTS (SELECT 1 FROM Deliverable d JOIN Document doc ON doc.id=d.documentId AND doc.projectId=d.projectId WHERE d.projectId=t.projectId AND d.taskId=t.id AND d.status='APPROVED' AND doc.storageStatus='AVAILABLE' AND doc.sha256 REGEXP '^[a-fA-F0-9]{64}$')`;
// No six-month cutoff: historical unhandled actions must not silently disappear.
const actionRows = Prisma.sql`MeetingRecord m JOIN JSON_TABLE(CASE WHEN JSON_TYPE(m.actionItems)='ARRAY' THEN m.actionItems ELSE JSON_ARRAY(JSON_OBJECT('text','行动项数据格式无效')) END, '$[*]' COLUMNS (ordinal FOR ORDINALITY, itemText VARCHAR(500) PATH '$.text' NULL ON ERROR, taskId VARCHAR(191) PATH '$.taskId' NULL ON ERROR)) jt LEFT JOIN Task linked ON linked.id=jt.taskId COLLATE utf8mb4_unicode_ci AND linked.projectId=m.projectId AND CHAR_LENGTH(jt.taskId)=36`;
export async function readCounts(tx: Prisma.TransactionClient, projectId: string) {
  const [tasks, meetings] = await Promise.all([
    tx.$queryRaw<{ total: bigint; incomplete: bigint | null; missingFiles: bigint | null; unsignedCount: bigint | null }[]>`SELECT COUNT(*) total, SUM(t.status NOT IN ('DONE','CANCELLED')) incomplete, SUM(t.status<>'CANCELLED' AND t.requiresDeliverable AND NOT ${hasDeliverable}) missingFiles, SUM(t.status='DONE' AND NOT ${validSignature}) unsignedCount FROM Task t WHERE t.projectId=${projectId} AND t.status<>'CANCELLED'`,
    tx.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) n FROM ${actionRows} WHERE m.projectId=${projectId} AND linked.id IS NULL`,
  ]);
  const row = tasks[0];
  const requirements = await requirementAcceptance(tx, projectId);
  return countsSchema.parse({ UNCOMPLETED_TASKS: Number(row.incomplete ?? 0), MISSING_DELIVERABLES: Number(row.missingFiles ?? 0), MISSING_SIGNATURES: Number(row.unsignedCount ?? 0), UNLINKED_ACTION_ITEMS: Number(meetings[0].n), EMPTY_PROJECT: Number(row.total) === 0 ? 1 : 0, ...(requirements.enabled ? { REQUIREMENT_GAPS: requirements.gapCount } : {}) });
}
export async function readDetails(tx: Prisma.TransactionClient, projectId: string, rule: CheckRule, role: string, page: number, pageSize = 20): Promise<GapDetail[]> {
  const offset = (page - 1) * pageSize;
  if (rule === "REQUIREMENT_GAPS") {
    const result = await requirementAcceptance(tx, projectId);
    return result.requirements.filter(r => !r.passed).slice(offset, offset + pageSize).map(r => ({ entityId: r.requirementId, label: `${r.number ?? "需求"} · 当前基线版本尚未完成交付验证` }));
  }
  if (rule === "UNLINKED_ACTION_ITEMS") {
    const rows = await tx.$queryRaw<(Omit<GapDetail, "ordinal"> & { ordinal: bigint | number })[]>`SELECT m.id entityId, CASE WHEN ${role}='ADMIN' OR JSON_CONTAINS(m.visibleRoles,JSON_QUOTE(${role})) THEN CONCAT(LEFT(m.title,100),' · ',LEFT(COALESCE(jt.itemText,'未命名行动项'),100)) ELSE '受限会议存在未处理行动项，请联系负责人' END label, jt.ordinal ordinal FROM ${actionRows} WHERE m.projectId=${projectId} AND linked.id IS NULL ORDER BY m.id,jt.ordinal LIMIT ${pageSize} OFFSET ${offset}`;
    // MySQL FOR ORDINALITY is unsigned; Prisma returns bigint, which JSON cannot serialize.
    return rows.map(row => ({ ...row, ordinal: Number(row.ordinal) }));
  }
  if (rule === "EMPTY_PROJECT") return [];
  const condition = rule === "UNCOMPLETED_TASKS" ? Prisma.sql`t.status NOT IN ('DONE','CANCELLED')` : rule === "MISSING_DELIVERABLES" ? Prisma.sql`t.status<>'CANCELLED' AND t.requiresDeliverable AND NOT ${hasDeliverable}` : Prisma.sql`t.status='DONE' AND NOT ${validSignature}`;
  return tx.$queryRaw<GapDetail[]>`SELECT t.id entityId, t.title label FROM Task t WHERE t.projectId=${projectId} AND ${condition} ORDER BY t.id LIMIT ${pageSize} OFFSET ${offset}`;
}
/** Hash bounded pages, never load full business records or use truncated GROUP_CONCAT. */
export async function evidenceFingerprint(tx: Prisma.TransactionClient, projectId: string) {
  const hash = createHash("sha256").update("acceptance-rules-v1\n");
  const sources = [
    { table: Prisma.sql`Task`, filter: Prisma.sql`projectId=${projectId}`, value: Prisma.sql`CASE WHEN completionRoundId IS NULL THEN JSON_ARRAY(id,title,status,requiresDeliverable,completedAt,actualHours,assigneeId,requirementId,plannedStartDate,dueDate,estimateHours,SHA2(COALESCE(description,''),256),updatedAt) ELSE JSON_ARRAY(JSON_ARRAY(id,title,status,requiresDeliverable,completedAt,actualHours,assigneeId,requirementId,plannedStartDate,dueDate,estimateHours,SHA2(COALESCE(description,''),256),updatedAt),completionRoundId) END` },
    { table: Prisma.sql`Deliverable`, filter: Prisma.sql`projectId=${projectId}`, value: Prisma.sql`JSON_ARRAY(id,taskId,version,status,documentId,updatedAt)` },
    { table: Prisma.sql`Document`, filter: Prisma.sql`projectId=${projectId}`, value: Prisma.sql`JSON_ARRAY(id,sha256,storageStatus,minioKey)` },
    { table: Prisma.sql`MeetingRecord`, filter: Prisma.sql`projectId=${projectId}`, value: Prisma.sql`JSON_ARRAY(id,status,rowVersion,updatedAt,SHA2(CAST(actionItems AS CHAR),256))` },
    { table: Prisma.sql`AuditLog`, filter: Prisma.sql`projectId=${projectId} AND entityType='Task' AND action='TASK_SIGNED_AND_COMPLETED'`, value: Prisma.sql`JSON_ARRAY(id,entityId,SHA2(CAST(AuditLog.after AS CHAR),256))` },
  ];
  // Preserve existing fingerprints for projects without managed requirements.
  if (await tx.requirement.count({ where: { projectId, managed: true } })) sources.push(
    { table: Prisma.sql`Requirement`, filter: Prisma.sql`projectId=${projectId} AND managed=TRUE`, value: Prisma.sql`JSON_ARRAY(id,rowVersion,workflowState,approvedVersion,draftVersion,dueDate,completedAt)` },
    { table: Prisma.sql`RequirementBaseline`, filter: Prisma.sql`projectId=${projectId}`, value: Prisma.sql`JSON_ARRAY(id,sha256)` },
    { table: Prisma.sql`TestExecution`, filter: Prisma.sql`projectId=${projectId}`, value: Prisma.sql`JSON_ARRAY(id,revisionId,result,documentId)` },
    { table: Prisma.sql`RequirementTaskLink`, filter: Prisma.sql`projectId=${projectId}`, value: Prisma.sql`JSON_ARRAY(id,requirementId,taskId)` },
    { table: Prisma.sql`TestCase`, filter: Prisma.sql`requirementId IN (SELECT id FROM Requirement WHERE projectId=${projectId} AND managed=TRUE)`, value: Prisma.sql`JSON_ARRAY(id,SHA2(title,256),updatedAt)` },
  );
  for (const [index, source] of sources.entries()) {
    hash.update(`source:${index}\n`); let cursor = "";
    while (true) {
      const page = await tx.$queryRaw<{ id: string; token: string }[]>`SELECT id,SHA2(CAST(${source.value} AS CHAR),256) token FROM ${source.table} WHERE ${source.filter} AND id>${cursor} ORDER BY id LIMIT 200`;
      for (const row of page) hash.update(`${row.id}:${row.token}\n`);
      if (page.length < 200) break; cursor = page[page.length - 1].id;
    }
  }
  return hash.digest("hex");
}
