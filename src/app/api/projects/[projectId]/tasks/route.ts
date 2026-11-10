import { createTaskSchema } from "@/modules/tasks/create-schema";
import { businessErrorResponse } from "@/modules/audit/errors";
import { projectScoped } from "@/modules/auth/project-scope-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { createTask } from "@/modules/audit/service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return denied;
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const data = await prisma.task.findMany({
    where: { projectId },
    include: {
      assignee: { select: { id: true, name: true } },
      deliverables: { where: { status: "APPROVED", document: { storageStatus: "AVAILABLE" } }, select: { id: true } },
      requirement: { select: { id: true, title: true } },
      dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ data });
}

async function POSTHandler(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM"]);
  if (denied) return denied;
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid task", issues: parsed.error.issues }, { status: 400 });
  try {
    const task = await createTask({ projectId, ...parsed.data, actorId: user!.id, ...getAuditRequestMetadata(request) });
    return NextResponse.json({ data: task }, { status: 201 });
  } catch (error) { return businessErrorResponse(error); }
}

export const GET = projectScoped(GETHandler);
export const POST = projectScoped(POSTHandler);
