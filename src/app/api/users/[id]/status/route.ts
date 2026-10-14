import { NextResponse } from "next/server";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { statusSchema, userIdSchema } from "@/modules/users/schemas";
import { changeManagedUserStatus } from "@/modules/users/services";
import { userManagementResponse } from "@/modules/users/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentUser();
    const denied = requireRole(actor, ["ADMIN"]);
    if (denied || !actor) return denied!;
    const { id } = await context.params;
    const parsed = statusSchema.safeParse(await request.json().catch(() => null));
    if (!userIdSchema.safeParse(id).success || !parsed.success) return NextResponse.json({ error: "状态变更参数无效" }, { status: 400 });
    return NextResponse.json({ user: await changeManagedUserStatus({ actorId: actor.id, userId: id, status: parsed.data.status, ...getAuditRequestMetadata(request) }) });
  } catch (error) { return userManagementResponse(error); }
}
