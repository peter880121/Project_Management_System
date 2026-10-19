import { redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/session";
import { dashboardRoles } from "@/modules/dashboard/scope";
import { Dashboard } from "@/components/dashboard/dashboard";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
export const dynamic = "force-dynamic";
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const actor = await getCurrentUser(); if (!actor) redirect("/login?next=/dashboard");
  if (!dashboardRoles.some(role => role === actor.role)) return <main className="p-8"><h1 className="text-2xl font-semibold">无权访问数据决策中心</h1><p className="mt-3 text-slate-500">此页面仅向 ADMIN、PMO 和 PM 开放。</p></main>;
  const { projectId } = await searchParams;
  return <main className="min-h-screen min-w-0 bg-[radial-gradient(ellipse_at_top_left,_#d9f5ed_0%,_#f5f8fb_45%,_#f1f5f9_100%)] px-4 py-8 sm:px-8"><PageBreadcrumbs pathname="/dashboard" items={[{ label: "数据决策中心" }]}/><div className="mx-auto max-w-[1440px]"><Dashboard role={actor.role} projectId={projectId}/></div></main>;
}
