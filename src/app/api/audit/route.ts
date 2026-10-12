import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { auditQuerySchema, buildAuditWhere } from "@/modules/audit/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "QA"]);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const parsed = auditQuerySchema.safeParse(Object.fromEntries(params.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid audit filters", issues: parsed.error.issues }, { status: 400 });
  }

  const { limit } = parsed.data;
  const data = await prisma.auditLog.findMany({
    where: buildAuditWhere(parsed.data),
    include: { actor: { select: { id: true, name: true, role: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  return NextResponse.json({ data });
}
