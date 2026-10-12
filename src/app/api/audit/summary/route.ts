import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { runComplianceAudit } from "@/modules/ai/compliance-audit/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  projectId: z.uuid(),
  actorId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((value, context) => {
  if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) context.addIssue({ code: "custom", path: ["to"], message: "to must be at or after from" });
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "QA"]);
  if (denied) return denied;
  const parsedBody = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) return NextResponse.json({ error: "Invalid audit summary request", issues: parsedBody.error.issues }, { status: 400 });
  const filters = parsedBody.data;
  try {
    const result = await runComplianceAudit({
      projectId: filters.projectId,
      actorId: user!.id,
      actorFilter: filters.actorId,
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
      ...getAuditRequestMetadata(request),
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Unable to complete compliance audit scan" }, { status: 500 });
  }
}
