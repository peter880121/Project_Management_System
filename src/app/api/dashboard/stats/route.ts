import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { dashboardRoles } from "@/modules/dashboard/scope";
import { parseDashboardQuery } from "@/modules/dashboard/schemas";
import { DashboardAccessError, dashboardStats } from "@/modules/dashboard/service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET(request: Request) {
  try {
    const actor = await getCurrentUser(); const denied = requireRole(actor, dashboardRoles);
    if (denied) return new Response(denied.body, { status: denied.status, headers: { ...headers, "Content-Type": "application/json" } });
    const parsed = parseDashboardQuery(new URL(request.url).searchParams);
    if (!parsed.success) return Response.json({ error: "统计查询参数无效" }, { status: 400, headers });
    return Response.json({ data: await dashboardStats(actor!.id, parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof DashboardAccessError) return Response.json({ error: "权限已变更，请重新确认会话" }, { status: 403, headers });
    console.error("Dashboard aggregation failed");
    return Response.json({ error: "统计数据暂时不可用，请重试" }, { status: 503, headers });
  }
}
