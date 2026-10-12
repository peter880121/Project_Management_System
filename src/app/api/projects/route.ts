import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return denied;
  const data = await prisma.project.findMany({
    select: { id: true, name: true, description: true, status: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ data });
}
