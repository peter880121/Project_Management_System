import { Prisma } from "@prisma/client";
// Legacy rows preserve exact timestamp matching. New rows also require their unique round and actual effort.
// Both callers use Task t and AuditLog a; audit records remain append-only.
export const completionRoundEvidence = Prisma.sql`((t.signatureEvidenceVersion=1 AND t.completionRoundId IS NULL) OR (t.completionRoundId IS NOT NULL AND 
  JSON_UNQUOTE(JSON_EXTRACT(a.after,'$.completionRoundId'))=t.completionRoundId
  AND JSON_TYPE(JSON_EXTRACT(a.after,'$.actualHours')) IN ('STRING','INTEGER','DOUBLE')
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(a.after,'$.actualHours')) AS DECIMAL(8,2))=t.actualHours
  AND t.actualHours>0
))`;
