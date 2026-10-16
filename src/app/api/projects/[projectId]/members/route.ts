import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { projectScoped } from "@/modules/auth/project-scope-http";
import { complianceHttp, parseId, parseJson } from "@/modules/ai/compliance-audit/http";
import { getProjectMembers, memberSchema, setProjectMember } from "@/modules/projects/members";
type Context = { params: Promise<{ projectId: string }> };
export const GET = projectScoped(async (_request: Request, context: Context) => complianceHttp(["ADMIN", "PM", "QA", "MEMBER"], async (actor) => Response.json(await getProjectMembers(parseId((await context.params).projectId), actor))));
export const PUT = projectScoped(async (request: Request, context: Context) => complianceHttp(["ADMIN", "PM"], async (actor) => Response.json(await setProjectMember(parseId((await context.params).projectId), await parseJson(request, memberSchema), { actorId: actor.id, ...getAuditRequestMetadata(request) }))));
