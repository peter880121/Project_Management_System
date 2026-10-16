import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { projectScoped } from "@/modules/auth/project-scope-http";
import { complianceHttp, parseId, parseJson } from "@/modules/ai/compliance-audit/http";
import { exportSchema, exportResponse, generateComplianceExport } from "@/modules/exports/services";
import { listExports } from "@/modules/exports/repositories";
type Context = { params: Promise<{ projectId: string }> };
export const GET = projectScoped(async (_request: Request, context: Context) => complianceHttp(["ADMIN", "QA"], async () => Response.json(await listExports(parseId((await context.params).projectId)))));
export const POST = projectScoped(async (request: Request, context: Context) => complianceHttp(["ADMIN", "QA"], async (actor) => exportResponse(await generateComplianceExport(parseId((await context.params).projectId), await parseJson(request, exportSchema), { actorId: actor.id, ...getAuditRequestMetadata(request) }))));
