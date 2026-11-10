import { PageBackLink } from "@/components/page-back-link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { documentReaders } from "@/modules/documents/http";
import { DocumentsManager } from "./documents-manager";
import { DocumentSearchPanel } from "./search-panel";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";
export const dynamic = "force-dynamic";
export default async function DocumentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await getCurrentUser();
  if (requireRole(actor, documentReaders)) return <main className="p-8">请先登录查看项目文档。</main>;
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  if (!await hasProjectAccess(actor!, projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project) notFound();
  return <main className="mx-auto max-w-5xl space-y-5 p-8"><PageBreadcrumbs pathname={`/projects/${projectId}/documents`} items={projectBreadcrumbs(project, "文档")} /><PageBackLink href={`/projects/${projectId}/board`}>返回任务看板</PageBackLink><h1 className="text-3xl font-semibold">{project.name} · 项目文档</h1><p>支持合成数据 PDF、DOCX（最大 20 MB）及 TXT、TEXT、MD（最大 5 MB）。下载会记录操作者和文档范围。支持异步解析、结果预览和带来源的文档检索。</p><DocumentSearchPanel projectId={projectId} /><DocumentsManager projectId={projectId} role={actor!.role} /></main>;
}
