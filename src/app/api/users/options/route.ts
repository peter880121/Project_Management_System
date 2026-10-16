import { NextResponse } from "next/server";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { listUserOptions } from "@/modules/users/repositories";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { hasProjectAccess } from "@/modules/auth/project-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser(); const denied = requireRole(user, ["ADMIN", "PM"]);
  if (denied) return denied;
  try {
    const projectId = request ? new URL(request.url).searchParams.get("projectId") : null;
    if (projectId) {
      if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "项目 ID 无效" }, { status: 400 });
      if (!await hasProjectAccess(user!, projectId)) return NextResponse.json({ error: "无权访问项目" }, { status: 403 });
      return NextResponse.json({ data: await prisma.user.findMany({ where: { status: "ACTIVE", isSystem: false, OR: [{ ownedProjects: { some: { id: projectId } } }, { projectMemberships: { some: { projectId, active: true } } }] }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }) });
    }
    return NextResponse.json({ data: await listUserOptions() });
  } catch {
    return NextResponse.json({ error: "成员列表加载失败，请重试" }, { status: 500 });
  }
}
