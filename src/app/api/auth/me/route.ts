import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authenticatedRoles = ["ADMIN", "PM", "MEMBER", "QA"] as const;

export async function GET() {
  const currentUser = await getCurrentUser();
  const denied = requireRole(currentUser, authenticatedRoles);
  if (denied) return denied;
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { id: true, email: true, name: true, role: true, status: true, lastLoginAt: true },
  });
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  return NextResponse.json({ user }, { status: 200 });
}
