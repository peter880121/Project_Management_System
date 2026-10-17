import { projectScoped } from "@/modules/auth/project-scope-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { containsLikelySensitiveInput, generateWbsSuggestions } from "@/modules/ai/wbs/service";
import { storedDocumentEvidence } from "@/modules/ai/wbs/types";
import { dependencyIds, suggestionTitle } from "@/modules/ai/wbs/review-state";
import { wbsFailureMessage } from "@/modules/ai/wbs/failure";
import { projectErrorResponse } from "@/modules/projects/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getHistoryIds(input: Prisma.JsonValue): string[] {
  if (!input || Array.isArray(input) || typeof input !== "object") return [];
  const ids = input.retrievalHitIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

async function GETHandler(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["PM"]);
  if (denied) return denied;
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  const sourceTaskId = new URL(_request.url).searchParams.get("sourceTaskId");
  if (sourceTaskId && !z.uuid().safeParse(sourceTaskId).success) return NextResponse.json({ error: "Invalid source task id" }, { status: 400 });
  const suggestions = await prisma.aiSuggestion.findMany({
    where: { projectId, type: "WBS", status: "PENDING", ...(sourceTaskId ? { input: { path: "$.sourceTaskId", equals: sourceTaskId } } : {}) },
    select: { id: true, input: true, output: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 90,
  });
  const ids = [...new Set(suggestions.flatMap((suggestion) => getHistoryIds(suggestion.input)))];
  const prerequisiteIds = [...new Set(suggestions.flatMap(s => dependencyIds(s.output)))];
  const prerequisites = prerequisiteIds.length ? await prisma.aiSuggestion.findMany({
    where: { id: { in: prerequisiteIds }, projectId, type: "WBS" },
    select: { id: true, output: true, status: true },
  }) : [];
  const prerequisiteById = new Map(prerequisites.map(s => [s.id, s]));
  const history = ids.length === 0 ? [] : await prisma.task.findMany({
    where: { id: { in: ids }, projectId, status: "DONE", actualHours: { not: null }, completedAt: { not: null } },
    select: { id: true, title: true, description: true, actualHours: true, createdAt: true, completedAt: true },
  });
  const historyById = new Map(history.map((task) => [task.id, task]));
  return NextResponse.json({ data: suggestions.map((suggestion) => ({
    id: suggestion.id,
    output: suggestion.output,
    prerequisites: dependencyIds(suggestion.output).map(id => {
      const prerequisite = prerequisiteById.get(id);
      return { id, title: prerequisite ? suggestionTitle(prerequisite.output) : "未知前置任务", status: prerequisite?.status ?? "MISSING" };
    }),
    createdAt: suggestion.createdAt,
    documentEvidence: storedDocumentEvidence(suggestion.input),
    history: getHistoryIds(suggestion.input).flatMap((id) => {
      const task = historyById.get(id);
      return task?.actualHours && task.completedAt ? [{
        id: task.id,
        title: task.title,
        description: task.description,
        actualHours: Number(task.actualHours),
        deliveryDays: Math.max(0, Math.round(((task.completedAt.getTime() - task.createdAt.getTime()) / 86_400_000) * 100) / 100),
      }] : [];
    }),
  })) });
}

const generateSchema = z.object({
  sourceTaskId: z.uuid().optional(),
  request: z.string().trim().min(10).max(8000),
  syntheticDataConfirmed: z.literal(true),
}).strict();

async function POSTHandler(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["PM"]);
  if (denied) return denied;
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a requirement and confirm it contains synthetic data only", issues: parsed.error.issues }, { status: 400 });
  if (containsLikelySensitiveInput(parsed.data.request)) return NextResponse.json({ error: "Potential patient or contact identifiers found. Remove them and use synthetic data only." }, { status: 400 });
  let result: Awaited<ReturnType<typeof generateWbsSuggestions>>;
  try {
    result = await generateWbsSuggestions({ projectId, actorId: user!.id, request: parsed.data.request, sourceTaskId: parsed.data.sourceTaskId, ...getAuditRequestMetadata(request) });
  } catch (error) { return projectErrorResponse(error); }
  return NextResponse.json({
    data: result.suggestions.map((suggestion) => ({ ...suggestion, history: result.historicalTasks, documentEvidence: result.documentEvidence })),
    degraded: result.degraded,
    model: result.model,
    modelDurationMs: result.modelDurationMs,
    manualFallback: result.manualFallback,
    failureCode: result.failureCode,
    message: result.manualFallback ? wbsFailureMessage(result.failureCode) : undefined,
  }, { status: result.manualFallback ? 200 : 201 });
}

export const GET = projectScoped(GETHandler);
export const POST = projectScoped(POSTHandler);
