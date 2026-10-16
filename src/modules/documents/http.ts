import { Prisma, type Role } from "@prisma/client";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole, type AuthenticatedUser } from "@/modules/auth/rbac";
import { DocumentError } from "./validation";
import { ProjectAccessError } from "@/modules/auth/project-access";
export const documentReaders: Role[] = ["ADMIN", "PM", "MEMBER", "QA"];
export async function documentHttp(roles: Role[], action: (actor: AuthenticatedUser) => Promise<Response>) {
  try {
    const actor = await getCurrentUser(); const denied = requireRole(actor, roles);
    if (denied || !actor) return denied!;
    return await action(actor);
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof DocumentError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) return Response.json({ error: "上传已记录或状态冲突，请刷新", }, { status: 409 });
    console.error("Document operation failed");
    return Response.json({ error: "文档操作失败，请稍后重试" }, { status: 500 });
  }
}
