import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess, visibleProjectWhere } from "@/modules/auth/project-access";
import { prisma } from "@/lib/prisma";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";
import { MembersPanel } from "./members-panel";
export const dynamic = "force-dynamic";
export default async function MembersPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ onboarding?: string }> }) {
  const actor = await getCurrentUser(); const { projectId } = await params;
  if (!actor || !await hasProjectAccess(actor, projectId)) notFound();
  const project = await prisma.project.findFirst({ where: { id: projectId, ...visibleProjectWhere(actor) }, select: { id: true, name: true } });
  if (!project) notFound();
  const onboarding = (await searchParams).onboarding === "1";
  return <main className="mx-auto max-w-5xl space-y-8 px-6 py-8 sm:px-8">
    <PageBreadcrumbs pathname={`/projects/${projectId}/members`} items={projectBreadcrumbs(project, "成员")} />
    <div><Link href={`/projects/${projectId}/board`} className="back-link inline-flex items-center text-sm font-medium text-teal-800">← 返回项目</Link></div>
    <div className="space-y-3">
      <h1 className="text-3xl font-semibold">项目成员</h1>
      <p className="max-w-3xl text-sm leading-7 text-slate-600">项目负责人和 ADMIN 可维护访问授权。成员操作仍受其系统角色限制，移出成员不会删除历史任务和审计记录。</p>
    </div>
    {onboarding && <section aria-label="新项目引导" className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-5"><p className="text-sm font-semibold text-teal-900">第 1 步 / 共 3 步 · 配置项目成员</p><p className="text-sm text-slate-700">先配置成员的项目访问权限，再分配任务负责人和排期。加入项目不会自动分配任务。</p><Link className="text-link text-sm font-semibold text-teal-800 underline" href={`/projects/${projectId}/planning?onboarding=1`}>下一步：分配负责人和排期 →</Link></section>}
    <MembersPanel projectId={projectId} />
  </main>;
}
