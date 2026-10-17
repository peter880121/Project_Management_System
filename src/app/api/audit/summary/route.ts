import { projectScoped } from "@/modules/auth/project-scope-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { runComplianceAudit } from "@/modules/ai/compliance-audit/service";
import { projectErrorResponse } from "@/modules/projects/http";

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
