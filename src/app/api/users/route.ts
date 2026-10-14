import { NextResponse } from "next/server";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { createUserSchema, parseListUsersQuery } from "@/modules/users/schemas";
import { listManagedUsers } from "@/modules/users/repositories";
import { createUserByAdmin } from "@/modules/users/services";
import { userManagementResponse } from "@/modules/users/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const denied = requireRole(await getCurrentUser(), ["ADMIN"]);
    if (denied) return denied;
    const parsed = parseListUsersQuery(new URL(request.url).searchParams);
    if (!parsed.success) return NextResponse.json({ error: "筛选或分页参数无效" }, { status: 400 });
    return NextResponse.json(await listManagedUsers(parsed.data));
  } catch (error) { return userManagementResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await getCurrentUser();
    const denied = requireRole(actor, ["ADMIN"]);
    if (denied || !actor) return denied!;
    const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "创建参数无效", issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, { status: 400 });
    return NextResponse.json({ user: await createUserByAdmin({ ...parsed.data, actorId: actor.id, ...getAuditRequestMetadata(request) }) }, { status: 201 });
  } catch (error) { return userManagementResponse(error); }
}
