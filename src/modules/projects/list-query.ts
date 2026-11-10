import { z } from "zod";
import type { Prisma } from "@prisma/client";
export const PROJECT_PAGE_SIZE = 12;
export const PROJECT_LIST_STATUSES = ["PLANNING", "ACTIVE", "PENDING_ACCEPTANCE", "ON_HOLD", "ARCHIVED", "CANCELLED", "COMPLETED"] as const;
const querySchema = z.object({ view: z.enum(["current", "all"]).catch("current"), status: z.enum(PROJECT_LIST_STATUSES).nullable().catch(null), q: z.string().trim().max(100).catch(""), sort: z.enum(["created_desc", "name_asc"]).catch("created_desc"), page: z.coerce.number().int().min(1).max(100000).catch(1), created: z.uuid().optional().catch(undefined) });
export type ProjectListQuery = z.infer<typeof querySchema>;
export type ProjectListParams = Record<string, string | string[] | undefined>;
export function parseProjectListQuery(params: ProjectListParams): ProjectListQuery {
  const first = (key: string) => Array.isArray(params[key]) ? params[key][0] : params[key];
  return querySchema.parse({ view: first("status") === "ALL" ? "all" : first("view"), status: first("status"), q: (first("q") ?? "").trim().slice(0, 100), sort: first("sort"), page: first("page"), created: first("created") });
}
export function projectListUrl(query: ProjectListQuery, changes: Partial<ProjectListQuery> = {}) {
  const value = { ...query, ...changes }; const params = new URLSearchParams();
  if (value.status) params.set("status", value.status); else params.set("view", value.view);
  if (value.q) params.set("q", value.q);
  if (value.sort !== "created_desc") params.set("sort", value.sort);
  if (value.page > 1) params.set("page", String(value.page));
  return params.toString() === "view=current" ? "/projects" : `/projects?${params}`;
}
export function projectListReturnTo(raw: unknown) {
  if (typeof raw !== "string" || !raw.startsWith("/projects?")) return "/projects";
  try { const url = new URL(raw, "https://project-list.local"); if (url.origin !== "https://project-list.local" || url.pathname !== "/projects") return "/projects"; return projectListUrl(parseProjectListQuery(Object.fromEntries(url.searchParams))); } catch { return "/projects"; }
}
export function projectListWhere(visibility: Prisma.ProjectWhereInput, query: ProjectListQuery, includeStatus = true): Prisma.ProjectWhereInput {
  const keyword = query.q.replace(/[\\%_]/g, "\\$&");
  const conditions: Prisma.ProjectWhereInput[] = [visibility];
  if (keyword) conditions.push({ OR: [{ name: { contains: keyword } }, { description: { contains: keyword } }] });
  if (includeStatus && query.status) conditions.push({ status: query.status });
  else if (includeStatus && query.view === "current") conditions.push({ status: { in: ["PLANNING", "ACTIVE"] } });
  return { AND: conditions };
}
export function projectListOrder(query: ProjectListQuery): Prisma.ProjectOrderByWithRelationInput[] {
  return query.sort === "name_asc" ? [{ name: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }];
}
