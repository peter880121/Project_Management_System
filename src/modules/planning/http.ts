import { Prisma, type Role } from "@prisma/client";
import { freezeErrorResponse } from "@/modules/projects/freeze";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole, type AuthenticatedUser } from "@/modules/auth/rbac";
import { PlanningError } from "./schemas";
import { ProjectAccessError } from "@/modules/auth/project-access";
export async function planningHttp(roles: Role[], action: (user: AuthenticatedUser) => Promise<Response>) {
  try { const user = await getCurrentUser(); const denied = requireRole(user, roles); if (denied || !user) return denied!; return await action(user); }
  catch (error) {
    const frozen = freezeErrorResponse(error); if (frozen) return frozen;
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof PlanningError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) return Response.json({ error: "排期或容量存在并发冲突，请刷新重试" }, { status: 409 });
    console.error("Planning operation failed"); return Response.json({ error: "排期操作失败，请稍后重试" }, { status: 500 });
  }
}
