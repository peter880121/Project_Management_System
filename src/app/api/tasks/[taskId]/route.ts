import { businessErrorResponse } from "@/modules/audit/errors";
import { projectScoped } from "@/modules/auth/project-scope-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { assignTask, changeTaskStatus } from "@/modules/audit/service";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";

import { signatureSchema } from "@/modules/tasks/signature";
import { lockAssetActor } from "@/modules/assets/services";
import { recordAudit } from "@/modules/audit/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const updateTaskSchema = z.union([
  z.object({ requiresDeliverable: z.boolean(), expectedUpdatedAt: z.iso.datetime() }).strict(),
  z.object({ status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED"]) }).strict(),
  z.object({ status: z.literal("DONE"), actualHours: z.number().positive().max(10_000), ...signatureSchema.shape }).strict(),
  z.object({ assigneeId: z.uuid().nullable() }).strict(),
]);

async function GETHandler(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return denied;
  const { taskId } = await context.params;
  if (!z.uuid().safeParse(taskId).success) return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: { select: { id: true, name: true } },
      deliverables: { where: { status: "APPROVED", document: { storageStatus: "AVAILABLE" } }, select: { id: true } },
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

async function PATCHHandler(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER"]);
  if (denied) return denied;
  const { taskId } = await context.params;
  if (!z.uuid().safeParse(taskId).success) return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid task update", issues: parsed.error.issues }, { status: 400 });
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, projectId: true, status: true, assigneeId: true } });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if ("requiresDeliverable" in parsed.data) {
    const setting = parsed.data;
    try {
      const data = await prisma.$transaction(async tx => {
        await lockAssetActor(tx, task.projectId, { actorId: user!.id }, ["PM", "ADMIN"]);
        const old = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
        if (old.status === "DONE" || old.updatedAt.toISOString() !== setting.expectedUpdatedAt) throw new Error("ASSET_TASK_CONFLICT");
        const changed = await tx.task.update({ where: { id: taskId }, data: { requiresDeliverable: setting.requiresDeliverable } });
        await recordAudit(tx, { actorId: user!.id, projectId: task.projectId, action: "TASK_DELIVERABLE_REQUIREMENT_CHANGED", entityType: "Task", entityId: taskId, before: { requiresDeliverable: old.requiresDeliverable }, after: { requiresDeliverable: changed.requiresDeliverable }, ...getAuditRequestMetadata(request) });
        return changed;
      });
      return NextResponse.json({ data });
    } catch (e) { if (e instanceof Error && e.message === "ASSET_TASK_CONFLICT") return NextResponse.json({ error: "任务已完成或已变化，请刷新" }, { status: 409 }); return businessErrorResponse(e); }
  }
  if ("assigneeId" in parsed.data) {
    if (user!.role !== "PM") return NextResponse.json({ error: "Only PM can assign tasks" }, { status: 403 });
    if (parsed.data.assigneeId) {
      const assignee = await prisma.user.findUnique({ where: { id: parsed.data.assigneeId }, select: { id: true } });
      if (!assignee) return NextResponse.json({ error: "Assignee not found" }, { status: 404 });
    }
    try {
      const data = await assignTask({ taskId, assigneeId: parsed.data.assigneeId, actorId: user!.id, ...getAuditRequestMetadata(request) });
      return NextResponse.json({ data });
    } catch (error) { return businessErrorResponse(error); }
  }
  const targetStatus = parsed.data.status;
  if (user!.role === "MEMBER" && task.assigneeId !== user!.id) {
    return NextResponse.json({ error: "Members can only update tasks assigned to them" }, { status: 403 });
  }
  if (task.status === "DONE" && user!.role === "MEMBER") {
    return NextResponse.json({ error: "Only PM or ADMIN can reopen a completed task" }, { status: 403 });
  }
  try {
    const data = await changeTaskStatus({ taskId, status: targetStatus, ...("actualHours" in parsed.data ? { actualHours: parsed.data.actualHours, signaturePassword: parsed.data.signaturePassword, signatureReason: parsed.data.signatureReason } : {}), actorId: user!.id, ...getAuditRequestMetadata(request) });
    return NextResponse.json({ data });
  } catch (error) { return businessErrorResponse(error); }
}

export const GET = projectScoped(GETHandler);
export const PATCH = projectScoped(PATCHHandler);
