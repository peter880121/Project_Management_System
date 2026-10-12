import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { acceptWbsSuggestion, reviewAiSuggestion } from "@/modules/audit/service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const decisionSchema = z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ suggestionId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["PM"]);
  if (denied) return denied;
  const { suggestionId } = await context.params;
  if (!z.uuid().safeParse(suggestionId).success) return NextResponse.json({ error: "Invalid suggestion id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid review decision", issues: parsed.error.issues }, { status: 400 });
  const suggestion = await prisma.aiSuggestion.findUnique({ where: { id: suggestionId }, select: { type: true } });
  if (!suggestion) return NextResponse.json({ error: "AI suggestion not found" }, { status: 404 });
  if (suggestion.type !== "WBS") return NextResponse.json({ error: "Suggestion is not a WBS task" }, { status: 400 });
  try {
    const metadata = { suggestionId, actorId: user!.id, ...getAuditRequestMetadata(request) };
    const result = parsed.data.decision === "ACCEPTED"
      ? await acceptWbsSuggestion(metadata)
      : await reviewAiSuggestion({ ...metadata, decision: "REJECTED" });
    return NextResponse.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to review suggestion";
    const status = message === "AI suggestion not found" ? 404 : message.startsWith("Accept or remove prerequisite") ? 409 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
