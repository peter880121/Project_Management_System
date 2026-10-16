import { z } from "zod";
import type { Role } from "@prisma/client";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole, type AuthenticatedUser } from "@/modules/auth/rbac";
import { projectErrorResponse } from "@/modules/projects/http";
import { ProjectError } from "@/modules/projects/services";

export async function complianceHttp(roles: Role[], action: (actor: AuthenticatedUser) => Promise<Response>) {
  try {
    const actor = await getCurrentUser();
    const denied = requireRole(actor, roles);
    if (denied || !actor) return denied!;
    return await action(actor);
  } catch (error) { return projectErrorResponse(error); }
}
export function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new ProjectError("ID 无效", 400);
  return parsed.data;
}
export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new ProjectError("输入无效", 400);
  return parsed.data;
}
