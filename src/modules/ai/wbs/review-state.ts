import type { Prisma } from "@prisma/client";

export function dependencyIds(output: Prisma.JsonValue): string[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  return Array.isArray(output.dependencyIds) ? output.dependencyIds.filter((id): id is string => typeof id === "string") : [];
}

export function suggestionTitle(output: Prisma.JsonValue): string {
  return output && typeof output === "object" && !Array.isArray(output) && typeof output.title === "string" ? output.title : "未知前置任务";
}

export type Prerequisite = { id: string; title: string; status: string };
export function prerequisiteMessage(dependencies: Prerequisite[]): string {
  const pending = dependencies.filter(d => d.status === "PENDING");
  const unavailable = dependencies.filter(d => !["PENDING", "ACCEPTED"].includes(d.status));
  return [
    pending.length ? `请先采纳前置任务：${pending.map(d => `《${d.title}》`).join("、")}` : "",
    unavailable.length ? `前置任务已拒绝或不可用：${unavailable.map(d => `《${d.title}》`).join("、")}。请拒绝此建议后重新生成，或人工创建任务并核对依赖` : "",
  ].filter(Boolean).join("；");
}

/** Prerequisites first; preserve source order for independent tasks and tolerate cycles. */
export function orderSuggestions<T extends { id: string; output: { dependencyIds?: string[] } }>(rows: T[]): T[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  const visited = new Set<string>();
  const result: T[] = [];
  function visit(row: T) {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    for (const id of row.output.dependencyIds ?? []) { const dependency = byId.get(id); if (dependency) visit(dependency); }
    result.push(row);
  }
  rows.forEach(visit);
  return result;
}
