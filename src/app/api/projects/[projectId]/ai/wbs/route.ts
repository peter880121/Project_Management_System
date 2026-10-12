import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { containsLikelySensitiveInput, generateWbsSuggestions } from "@/modules/ai/wbs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getHistoryIds(input: Prisma.JsonValue): string[] {
  if (!input || Array.isArray(input) || typeof input !== "object") return [];
  const ids = input.retrievalHitIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["PM"]);
  if (denied) return denied;
  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  const suggestions = await prisma.aiSuggestion.findMany({
    where: { projectId, type: "WBS", status: "PENDING" },
    select: { id: true, input: true, output: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 90,
  });
  const ids = [...new Set(suggestions.flatMap((suggestion) => getHistoryIds(suggestion.input)))];
  const history = ids.length === 0 ? [] : await prisma.task.findMany({
    where: { id: { in: ids }, projectId, status: "DONE", actualHours: { not: null }, completedAt: { not: null } },
    select: { id: true, title: true, description: true, actualHours: true, createdAt: true, completedAt: true },
  });
  const historyById = new Map(history.map((task) => [task.id, task]));
  return NextResponse.json({ data: suggestions.map((suggestion) => ({
    id: suggestion.id,
    output: suggestion.output,
    createdAt: suggestion.createdAt,
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
  request: z.string().trim().min(10).max(8000),
  syntheticDataConfirmed: z.literal(true),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
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
  const result = await generateWbsSuggestions({ projectId, actorId: user!.id, request: parsed.data.request, ...getAuditRequestMetadata(request) });
  return NextResponse.json({
    data: result.suggestions.map((suggestion) => ({ ...suggestion, history: result.historicalTasks })),
    degraded: result.degraded,
    model: result.model,
    modelDurationMs: result.modelDurationMs,
    manualFallback: result.manualFallback,
    message: result.manualFallback ? "AI generation failed; create tasks manually." : undefined,
  }, { status: result.manualFallback ? 200 : 201 });
}
