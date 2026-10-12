import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { generateProjectRiskWarnings, getPendingRiskWarnings } from "@/modules/ai/risk/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["PM"]);
  if (denied) return denied;
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  const data = await getPendingRiskWarnings(projectId);
  return NextResponse.json({ data });
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["PM"]);
  if (denied) return denied;
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  try {
    const result = await generateProjectRiskWarnings({ projectId, actorId: user!.id, ...getAuditRequestMetadata(request) });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found") return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "Unable to scan project risks" }, { status: 500 });
  }
}
