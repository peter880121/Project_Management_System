import { NextResponse } from "next/server";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { listUserOptions } from "@/modules/users/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = requireRole(await getCurrentUser(), ["ADMIN", "PM"]);
  if (denied) return denied;
  try {
    return NextResponse.json({ data: await listUserOptions() });
  } catch {
    return NextResponse.json({ error: "成员列表加载失败，请重试" }, { status: 500 });
  }
}
