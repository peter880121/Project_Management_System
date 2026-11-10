import { PageBackLink } from "@/components/page-back-link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess, visibleProjectWhere } from "@/modules/auth/project-access";
import { prisma } from "@/lib/prisma";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";
import { MembersWorkspace } from "./members-workspace";
export const dynamic = "force-dynamic";
export default async function MembersPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ onboarding?: string }> }) {
  const actor = await getCurrentUser(); const { projectId } = await params;
  if (!actor || !await hasProjectAccess(actor, projectId)) notFound();
  const project = await prisma.project.findFirst({ where: { id: projectId, ...visibleProjectWhere(actor) }, select: { id: true, name: true } });
  if (!project) notFound();
  const onboarding = (await searchParams).onboarding === "1";
  return <main className="mx-auto max-w-5xl space-y-8 px-6 py-8 sm:px-8">
    <PageBreadcrumbs pathname={`/projects/${projectId}/members`} items={projectBreadcrumbs(project, "成员")} />
    <div><PageBackLink href={`/projects/${projectId}/board`}>返回任务看板</PageBackLink></div>
    <div className="space-y-3">
      <h1 className="text-3xl font-semibold">项目成员</h1>
      <p className="max-w-3xl text-sm leading-7 text-slate-600">项目负责人和 ADMIN 可维护访问授权。成员操作仍受其系统角色限制，移出成员不会删除历史任务和审计记录。</p>
    </div>
    <MembersWorkspace projectId={projectId} onboarding={onboarding} />
  </main>;
}
