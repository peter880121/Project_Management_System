import { projectScoped } from "@/modules/auth/project-scope-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { runComplianceAudit } from "@/modules/ai/compliance-audit/service";
import { projectErrorResponse } from "@/modules/projects/http";

import { generationId, generationResponse, wantsStream } from "@/modules/ai/streaming/response";
import { loadAiTask } from "@/modules/ai/task-context";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  projectId: z.uuid(),
  taskId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((value, context) => {
  if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) context.addIssue({ code: "custom", path: ["to"], message: "to must be at or after from" });
});

async function POSTHandler(request: Request) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "QA", "PM"]);
  if (denied) return denied;
  const parsedBody = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) return NextResponse.json({ error: "Invalid audit summary request", issues: parsedBody.error.issues }, { status: 400 });
  const filters = parsedBody.data;
  if (user!.role === "PM" && (!filters.taskId || filters.actorId || filters.from || filters.to)) return NextResponse.json({ error: "PM 仅可执行任务级证据检查" }, { status: 403 });
  try {
    if (wantsStream(request)) {
      if (filters.taskId) await loadAiTask(filters.projectId, filters.taskId, "compliance");
      else if (!await prisma.project.findUnique({ where: { id: filters.projectId }, select: { id: true } })) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
      const id = generationId(request);
      return generationResponse(request, { generationId: id, projectId: filters.projectId, actorId: user!.id, taskId: filters.taskId, ...getAuditRequestMetadata(request) }, stream => runComplianceAudit({
        projectId: filters.projectId, taskId: filters.taskId, actorId: user!.id, actorFilter: filters.actorId,
        from: filters.from ? new Date(filters.from) : undefined, to: filters.to ? new Date(filters.to) : undefined,
        ...getAuditRequestMetadata(request),
      }, stream));
    }
    const result = await runComplianceAudit({
      projectId: filters.projectId,
      taskId: filters.taskId,
      actorId: user!.id,
      actorFilter: filters.actorId,
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
      ...getAuditRequestMetadata(request),
    });
    return NextResponse.json(result);
  } catch (error) {
    return projectErrorResponse(error);
  }
}

export const POST = projectScoped(POSTHandler);

async function GETHandler(request: Request) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "QA", "PM"]);
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const parsed = z.object({ projectId: z.uuid(), taskId: z.uuid(), generationId: z.uuid() }).safeParse(Object.fromEntries(query));
  if (!parsed.success) return NextResponse.json({ error: "核对参数无效" }, { status: 400 });
  try {
    const { projectId, taskId, generationId: id } = parsed.data;
    await loadAiTask(projectId, taskId, "compliance");
    const row = await prisma.aiSuggestion.findFirst({ where: { id, projectId, type: "AUDIT_SUMMARY", input: { path: "$.filters.taskId", equals: taskId } }, select: { id: true, output: true, status: true } });
    if (!row) return NextResponse.json({ error: "尚未查到已保存结果，请稍后核对" }, { status: 404 });
    return NextResponse.json({ ...(row.output as object), summaryId: row.id, status: row.status });
  } catch (error) { return projectErrorResponse(error); }
}
export const GET = projectScoped(GETHandler);
