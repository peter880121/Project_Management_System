import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "./session";
import { assertProjectAccess, ProjectAccessError } from "./project-access";
async function resolveScope(request: Request): Promise<string | null | undefined> {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const kind = parts[1]; const id = parts[2];
  if (kind === "projects") return z.uuid().safeParse(id).success ? id : undefined;
  if (["documents", "tasks", "risk-jobs", "exports", "notifications"].includes(kind)) {
    if (!z.uuid().safeParse(id).success) return undefined;
    if (kind === "documents") return (await prisma.document.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null;
    if (kind === "tasks") return (await prisma.task.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null;
    if (kind === "risk-jobs") return (await prisma.riskScanJob.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null;
    if (kind === "exports") return (await prisma.complianceExport.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null;
    return (await prisma.riskNotification.findUnique({ where: { id }, select: { suggestion: { select: { projectId: true } } } }))?.suggestion.projectId ?? null;
  }
  if (kind === "ai" || kind === "audit" && id === "summaries" && parts[3]) {
    const suggestionId = parts[3]; if (!z.uuid().safeParse(suggestionId).success) return undefined;
    return (await prisma.aiSuggestion.findUnique({ where: { id: suggestionId }, select: { projectId: true } }))?.projectId ?? null;
  }
  if (kind === "audit" && z.uuid().safeParse(id).success) return (await prisma.auditLog.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null;
  if (kind === "audit") {
    const query = new URL(request.url).searchParams.get("projectId"); if (query && z.uuid().safeParse(query).success) return query;
    if (request.method === "POST") { const body = await request.clone().json().catch(() => null); if (z.uuid().safeParse(body?.projectId).success) return body.projectId; }
  }
  return undefined;
}
export function projectScoped(handler: (request: Request) => Promise<Response> | Response): (request: Request) => Promise<Response>;
export function projectScoped<C>(handler: (request: Request, context: C) => Promise<Response> | Response): (request: Request, context: C) => Promise<Response>;
export function projectScoped<C>(handler: (request: Request, context: C) => Promise<Response> | Response) {
  return async (request: Request, context?: C): Promise<Response> => {
    try {
      const actor = await getCurrentUser(); if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
      if (actor.role !== "ADMIN") {
        const scope = await resolveScope(request);
        if (scope === null) return Response.json({ error: "项目记录不存在或不可访问" }, { status: 403 });
        if (scope) await assertProjectAccess(actor, scope);
      }
      return await handler(request, context!);
    } catch (error) {
      if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status });
      console.error("Project-scoped request failed"); return Response.json({ error: "项目操作失败", }, { status: 500 });
    }
  };
}
