import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { documentReaders } from "@/modules/documents/http";
import { DocumentsManager } from "./documents-manager";
import { DocumentSearchPanel } from "./search-panel";
import { hasProjectAccess } from "@/modules/auth/project-access";
export const dynamic = "force-dynamic";
export default async function DocumentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await getCurrentUser();
  if (requireRole(actor, documentReaders)) return <main className="p-8">请先登录查看项目文档。</main>;
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  if (!await hasProjectAccess(actor!, projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project) notFound();
  return <main className="mx-auto max-w-5xl space-y-5 p-8"><Link href={`/projects/${projectId}/board`} className="text-teal-800 underline">← 返回看板</Link><h1 className="text-3xl font-semibold">{project.name} · 项目文档</h1><p>仅上传合成数据 PDF，最大 20 MB。下载会记录操作者和文档范围。支持异步云端解析、结果预览和带来源的文档检索。</p><DocumentSearchPanel projectId={projectId} /><DocumentsManager projectId={projectId} role={actor!.role} /></main>;
}
