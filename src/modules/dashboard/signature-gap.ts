import { Prisma } from "@prisma/client";
import { completionRoundEvidence } from "@/modules/tasks/signature-evidence";
import { SIGNATURE_REASONS } from "@/modules/tasks/signature";
// Same current-round evidence contract as the existing dashboard anti-join.
// Aliases t (Task) and a (AuditLog) are internal constants, never user input.
export const missingSignature = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM AuditLog a WHERE a.projectId=t.projectId AND a.entityType='Task'
  AND a.entityId=t.id AND a.action='TASK_SIGNED_AND_COMPLETED'
  AND JSON_UNQUOTE(JSON_EXTRACT(a.after,'$.status'))='DONE'
  AND JSON_UNQUOTE(JSON_EXTRACT(a.after,'$.signatureReason')) IN (${Prisma.join([...SIGNATURE_REASONS])})
  AND JSON_UNQUOTE(JSON_EXTRACT(a.after,'$.completedAt'))=CONCAT(DATE_FORMAT(t.completedAt,'%Y-%m-%dT%H:%i:%s.'),LPAD(FLOOR(MICROSECOND(t.completedAt)/1000),3,'0'),'Z')
  AND ${completionRoundEvidence})`;
