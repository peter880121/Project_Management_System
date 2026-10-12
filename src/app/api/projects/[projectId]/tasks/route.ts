import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { createTask } from "@/modules/audit/service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(191),
  description: z.string().trim().max(10_000).optional(),
  requirementId: z.uuid().optional(),
}).strict();

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
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
      requirement: { select: { id: true, title: true } },
      dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ data });
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create task";
    if (message === "Project not found" || message.startsWith("Requirement not found")) return NextResponse.json({ error: message }, { status: 404 });
    throw error;
  }
}
