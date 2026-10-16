import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess, visibleProjectWhere } from "@/modules/auth/project-access";
import { prisma } from "@/lib/prisma";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";
import { ExportPanel } from "./export-panel";
export const dynamic = "force-dynamic";
export default async function ExportsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await getCurrentUser(); const { projectId } = await params;
  if (!actor || !["ADMIN", "QA"].includes(actor.role) || !await hasProjectAccess(actor, projectId)) notFound();
  const project = await prisma.project.findFirst({ where: { id: projectId, ...visibleProjectWhere(actor) }, select: { id: true, name: true } });
  if (!project) notFound();
  return <main className="mx-auto max-w-5xl space-y-6 p-8"><PageBreadcrumbs pathname={`/projects/${projectId}/exports`} items={projectBreadcrumbs(project, "合规导出")} /><Link href={`/projects/${projectId}/board`}>返回项目</Link><h1 className="text-2xl font-semibold">合规证据导出</h1><p>CSV 导出需求、任务和测试的追溯矩阵；JSON 包含业务快照、审计事件和最近审计摘要。时间范围仅过滤审计事件，业务数据均为当前快照。报告不代表合规批准，电子签名尚未实现。</p><ExportPanel projectId={projectId} /></main>;
}
