import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { projectScoped } from "@/modules/auth/project-scope-http";
import { complianceHttp, parseId } from "@/modules/ai/compliance-audit/http";
import { downloadComplianceExport, exportResponse } from "@/modules/exports/services";
export const GET = projectScoped(async (request: Request, context: { params: Promise<{ id: string }> }) => complianceHttp(["ADMIN", "QA"], async (actor) => exportResponse(await downloadComplianceExport(parseId((await context.params).id), { actorId: actor.id, ...getAuditRequestMetadata(request) }))));
