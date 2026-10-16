import { businessErrorResponse } from "@/modules/audit/errors";
import { projectScoped } from "@/modules/auth/project-scope-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { reviewRiskSuggestion } from "@/modules/audit/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const decisionSchema = z.object({ decision: z.enum(["HANDLED", "IGNORED"]) }).strict();

async function PATCHHandler(request: Request, context: { params: Promise<{ suggestionId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["PM"]);
  if (denied) return denied;
  const { suggestionId } = await context.params;
  if (!z.uuid().safeParse(suggestionId).success) return NextResponse.json({ error: "Invalid suggestion id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid risk decision", issues: parsed.error.issues }, { status: 400 });
  try {
    const data = await reviewRiskSuggestion({ suggestionId, decision: parsed.data.decision, actorId: user!.id, ...getAuditRequestMetadata(request) });
    return NextResponse.json({ data });
  } catch (error) { return businessErrorResponse(error); }
}

export const PATCH = projectScoped(PATCHHandler);
