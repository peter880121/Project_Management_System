import { Prisma } from "@prisma/client";
/** Alias s is internal; cancelled task warnings remain historical evidence, not live risks. */
export const liveRiskTaskClause = Prisma.sql`NOT EXISTS (SELECT 1 FROM Task cancelled WHERE cancelled.projectId=s.projectId AND cancelled.status='CANCELLED' AND cancelled.id=JSON_UNQUOTE(JSON_EXTRACT(s.output,'$.taskId')) COLLATE utf8mb4_unicode_ci)`;
