import { z } from "zod";
export const dashboardQuerySchema = z.object({
  projectId: z.uuid().optional(),
  healthPage: z.coerce.number().int().min(1).max(10000).default(1),
  loadPage: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export function parseDashboardQuery(params: URLSearchParams) {
  const input: Record<string, string | string[]> = {};
  for (const key of params.keys()) { const values = params.getAll(key); input[key] = values.length === 1 ? values[0] : values; }
  return dashboardQuerySchema.safeParse(input);
}
