import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { assignTask, changeTaskStatus } from "@/modules/audit/service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const updateTaskSchema = z.union([
  z.object({ status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED"]) }).strict(),
  z.object({ status: z.literal("DONE"), actualHours: z.number().positive().max(10_000) }).strict(),
  z.object({ assigneeId: z.uuid().nullable() }).strict(),
]);

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return denied;
  const { taskId } = await context.params;
  if (!z.uuid().safeParse(taskId).success) return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: { select: { id: true, name: true } },
      requirement: { include: { testCases: { select: { id: true, title: true, status: true } } } },
      project: { select: { id: true, name: true } },
      dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
    },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const audits = await prisma.auditLog.findMany({
    where: { entityType: "Task", entityId: taskId },
    include: { actor: { select: { id: true, name: true, role: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ data: { ...task, audits } });
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER"]);
  if (denied) return denied;
  const { taskId } = await context.params;
  if (!z.uuid().safeParse(taskId).success) return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid task update", issues: parsed.error.issues }, { status: 400 });
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, status: true, assigneeId: true } });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if ("assigneeId" in parsed.data) {
    if (user!.role !== "PM") return NextResponse.json({ error: "Only PM can assign tasks" }, { status: 403 });
    if (parsed.data.assigneeId) {
      const assignee = await prisma.user.findUnique({ where: { id: parsed.data.assigneeId }, select: { id: true } });
      if (!assignee) return NextResponse.json({ error: "Assignee not found" }, { status: 404 });
    }
    try {
      const data = await assignTask({ taskId, assigneeId: parsed.data.assigneeId, actorId: user!.id, ...getAuditRequestMetadata(request) });
      return NextResponse.json({ data });
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to assign task" }, { status: 409 }); }
  }
  const targetStatus = parsed.data.status;
  if (user!.role === "MEMBER" && task.assigneeId !== user!.id) {
    return NextResponse.json({ error: "Members can only update tasks assigned to them" }, { status: 403 });
  }
  if (task.status === "DONE" && user!.role === "MEMBER") {
    return NextResponse.json({ error: "Only PM or ADMIN can reopen a completed task" }, { status: 403 });
  }
  try {
    const data = await changeTaskStatus({ taskId, status: targetStatus, ...("actualHours" in parsed.data ? { actualHours: parsed.data.actualHours } : {}), actorId: user!.id, ...getAuditRequestMetadata(request) });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update task";
    const status = message === "Task not found" ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
