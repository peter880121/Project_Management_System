import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { auditQuerySchema, buildAuditWhere } from "@/modules/audit/query";
import { visibleProjectWhere } from "@/modules/auth/project-access";
import { enrichAuditRows } from "@/modules/audit/repositories";

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
    where: { AND: [buildAuditWhere(parsed.data), ...(user!.role === "ADMIN" ? [] : [{ project: { is: visibleProjectWhere(user!) } }])] },
    include: { actor: { select: { id: true, name: true, role: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
  });

  const page = data.slice(0, limit);
  return NextResponse.json({ data: await enrichAuditRows(page), nextCursor: data.length > limit ? page.at(-1)?.id : null });
}
