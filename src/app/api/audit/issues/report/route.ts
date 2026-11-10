import { z } from "zod";
import { complianceHttp, parseJson } from "@/modules/ai/compliance-audit/http";
import { auditReport } from "@/modules/audit/issue-service";
import { renderAuditReport } from "@/modules/audit/report";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return complianceHttp(["ADMIN", "QA"], async actor => {
    const body = await parseJson(request, z.object({ projectId: z.uuid() }).strict());
    const report = await auditReport({ actorId: actor.id, ...getAuditRequestMetadata(request) }, body.projectId);
    return new Response(renderAuditReport(report), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": 'attachment; filename="audit-remediation.html"', "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
  });
}
