import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { PlanningPanel } from "./planning-panel";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";
export const dynamic = "force-dynamic";
export default async function PlanningPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ onboarding?: string }> }) {
  const user = await getCurrentUser(); if (requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"])) return <main className="p-8">请先登录查看排期。</main>;
  const { projectId } = await params; if (!z.uuid().safeParse(projectId).success) notFound();
  if (!await hasProjectAccess(user!, projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }); if (!project) notFound();
  const onboarding = (await searchParams).onboarding === "1";
  return <main className="mx-auto max-w-6xl space-y-5 p-8"><PageBreadcrumbs pathname={`/projects/${projectId}/planning`} items={projectBreadcrumbs({ id: projectId, name: project.name }, "排期")} /><Link className="back-link text-teal-800 underline" href={`/projects/${projectId}/board`}>← 返回看板</Link><h1 className="text-3xl font-semibold">{project.name} · 排期与人员容量</h1><p>PM 人工维护任务计划与成员容量；日期按 UTC 日历日，截止到当日结束。容量按周一至周日统计，预计工时在计划日期间按日历天均摊，计入跨项目任务。尚未配置容量不会被视作零工时。</p>{onboarding && <section aria-label="新项目引导" className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-5"><p className="text-sm font-semibold text-teal-900">第 2 步 / 共 3 步 · 分配负责人和排期</p><p className="text-sm text-slate-700">点击任务打开详情并分配负责人；通过甘特图或表格设置日期，并配置成员周容量。准备就绪后进入看板执行。</p><Link className="text-link text-sm font-semibold text-teal-800 underline" href={`/projects/${projectId}/board`}>进入看板执行 →</Link></section>}<PlanningPanel projectId={projectId} canManage={user!.role === "PM"} role={user!.role} userId={user!.id} /></main>;
}
