import { ProjectError } from "@/modules/projects/services";
import type { Role } from "@prisma/client";
import { freezeErrorResponse } from "@/modules/projects/freeze";
import { assertProjectWritable, requestChangesBusiness } from "@/modules/projects/write-scope";
import { Prisma } from "@prisma/client";
import { ZodError, z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole, type AuthenticatedUser } from "@/modules/auth/rbac";
import { assertProjectAccess, ProjectAccessError } from "@/modules/auth/project-access";
import { AssetError } from "./validation";
export async function assetHttp(projectId: string, roles: Role[], action: (user: AuthenticatedUser) => Promise<Response>, request?: Request) {
  try {
    z.uuid().parse(projectId);
    const user = await getCurrentUser(); const denied = requireRole(user, roles); if (denied || !user) return denied!;
    await assertProjectAccess(user, projectId);
    if (request && requestChangesBusiness(request)) await assertProjectWritable(projectId);
    return await action(user);
  } catch (e) {
    const frozen = freezeErrorResponse(e); if (frozen) return frozen;
    if (e instanceof AssetError || e instanceof ProjectAccessError || e instanceof ProjectError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof ZodError || e instanceof SyntaxError) return Response.json({ error: "输入无效，请检查字段" }, { status: 400 });
    if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(e.code)) return Response.json({ error: "数据已变化，请刷新后重试" }, { status: 409 });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") return Response.json({ error: "系统繁忙，请重试" }, { status: 503 });
    console.error("ASSET_OPERATION_FAILED"); return Response.json({ error: "资产操作失败，请稍后重试" }, { status: 500 });
  }
}
