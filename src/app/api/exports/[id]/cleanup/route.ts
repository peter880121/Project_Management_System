import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { projectScoped } from "@/modules/auth/project-scope-http";
import { complianceHttp, parseId } from "@/modules/ai/compliance-audit/http";
import { cleanupComplianceExport } from "@/modules/exports/services";
export const POST = projectScoped(async (request: Request, context: { params: Promise<{ id: string }> }) => complianceHttp(["ADMIN", "QA"], async (actor) => Response.json(await cleanupComplianceExport(parseId((await context.params).id), { actorId: actor.id, ...getAuditRequestMetadata(request) }))));
