import { projectScoped } from "@/modules/auth/project-scope-http";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { loadTraceability } from "@/modules/projects/repositories";
import { traceCreateSchema, traceUpdateSchema } from "@/modules/projects/schemas";
import { saveTraceability } from "@/modules/projects/services";
import { projectErrorResponse } from "@/modules/projects/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string }> };
async function GETHandler(_request: Request, context: Context) {
  try {
    const denied = requireRole(await getCurrentUser(), ["ADMIN", "PM", "MEMBER", "QA"]);
    if (denied) return denied;
    const { projectId } = await context.params;
    if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "项目 ID 无效" }, { status: 400 });
    const data = await loadTraceability(projectId);
    return data ? Response.json({ data }) : Response.json({ error: "项目不存在" }, { status: 404 });
  } catch (error) { return projectErrorResponse(error); }
}
async function write(request: Request, context: Context, update: boolean) {
  try {
    const actor = await getCurrentUser();
    const denied = requireRole(actor, ["PM", "QA"]);
    if (denied || !actor) return denied!;
    const { projectId } = await context.params;
    if (!z.uuid().safeParse(projectId).success) return Response.json({ error: "项目 ID 无效" }, { status: 400 });
    const parsed = (update ? traceUpdateSchema : traceCreateSchema).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "输入无效", issues: parsed.error.issues }, { status: 400 });
    const allowed = parsed.data.kind === "testCase" ? "QA" : "PM";
    if (actor.role !== allowed) return Response.json({ error: `此操作需要 ${allowed} 角色` }, { status: 403 });
    return Response.json({ data: await saveTraceability(projectId, parsed.data, { actorId: actor.id, ...getAuditRequestMetadata(request) }) }, { status: update ? 200 : 201 });
  } catch (error) { return projectErrorResponse(error); }
}
const POSTHandler = (request: Request, context: Context) => write(request, context, false);
const PATCHHandler = (request: Request, context: Context) => write(request, context, true);

export const GET = projectScoped(GETHandler);
export const POST = projectScoped(POSTHandler);
export const PATCH = projectScoped(PATCHHandler);
