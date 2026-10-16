import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess, visibleProjectWhere } from "@/modules/auth/project-access";
import { prisma } from "@/lib/prisma";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";
import { MembersPanel } from "./members-panel";
export const dynamic = "force-dynamic";
export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await getCurrentUser(); const { projectId } = await params;
  if (!actor || !await hasProjectAccess(actor, projectId)) notFound();
  const project = await prisma.project.findFirst({ where: { id: projectId, ...visibleProjectWhere(actor) }, select: { id: true, name: true } });
  if (!project) notFound();
  return <main className="mx-auto max-w-5xl space-y-8 px-6 py-8 sm:px-8">
    <PageBreadcrumbs pathname={`/projects/${projectId}/members`} items={projectBreadcrumbs(project, "成员")} />
    <div><Link href={`/projects/${projectId}/board`} className="back-link inline-flex items-center text-sm font-medium text-teal-800">← 返回项目</Link></div>
    <div className="space-y-3">
      <h1 className="text-3xl font-semibold">项目成员</h1>
      <p className="max-w-3xl text-sm leading-7 text-slate-600">项目负责人和 ADMIN 可维护访问授权。成员操作仍受其系统角色限制，移出成员不会删除历史任务和审计记录。</p>
    </div>
    <MembersPanel projectId={projectId} />
  </main>;
}
