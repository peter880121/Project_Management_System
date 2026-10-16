import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { createProjectSchema } from "@/modules/projects/schemas";
import { createProject } from "@/modules/projects/services";
import { projectErrorResponse } from "@/modules/projects/http";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { visibleProjectWhere } from "@/modules/auth/project-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return denied;
  const data = await prisma.project.findMany({
    where: visibleProjectWhere(user!),
    select: { id: true, name: true, description: true, status: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  try {
    const actor = await getCurrentUser();
    const denied = requireRole(actor, ["PM"]);
    if (denied || !actor) return denied!;
    const parsed = createProjectSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "项目名称或描述无效" }, { status: 400 });
    const data = await createProject(parsed.data, { actorId: actor.id, ...getAuditRequestMetadata(request) });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) { return projectErrorResponse(error); }
}
