import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { reviewRiskSuggestion } from "@/modules/audit/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const decisionSchema = z.object({ decision: z.enum(["HANDLED", "IGNORED"]) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ suggestionId: string }> }) {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to review risk suggestion";
    const status = message === "AI suggestion not found" ? 404 : message === "Suggestion is not a risk warning" ? 400 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
