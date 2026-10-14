import { NextResponse } from "next/server";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { roleSchema, userIdSchema } from "@/modules/users/schemas";
import { changeManagedUserRole } from "@/modules/users/services";
import { userManagementResponse } from "@/modules/users/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentUser();
    const denied = requireRole(actor, ["ADMIN"]);
    if (denied || !actor) return denied!;
    const { id } = await context.params;
    const parsed = roleSchema.safeParse(await request.json().catch(() => null));
    if (!userIdSchema.safeParse(id).success || !parsed.success) return NextResponse.json({ error: "角色变更参数无效" }, { status: 400 });
    return NextResponse.json({ user: await changeManagedUserRole({ actorId: actor.id, userId: id, role: parsed.data.role, ...getAuditRequestMetadata(request) }) });
  } catch (error) { return userManagementResponse(error); }
}
