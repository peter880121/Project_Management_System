import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { documentReaders } from "@/modules/documents/http";
import { chunkSource } from "@/modules/documents/rag-repositories";
import { hasProjectAccess, visibleProjectWhere } from "@/modules/auth/project-access";
import { prisma } from "@/lib/prisma";
import { canReadRoles } from "@/modules/assets/validation";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";
export const dynamic = "force-dynamic";
export default async function ChunkSourcePage({ params }: { params: Promise<{ projectId: string; chunkId: string }> }) {
  const user = await getCurrentUser(); if (requireRole(user, documentReaders)) return <main className="p-8">请先登录查看文档来源。</main>;
  const { projectId, chunkId } = await params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(chunkId).success) notFound();
  if (!await hasProjectAccess(user!, projectId)) notFound();
  const chunk = await chunkSource(chunkId); if (!chunk || chunk.projectId !== projectId) notFound();
  if (!canReadRoles(chunk.document.visibleRoles, user!.role)) notFound();
  const project = await prisma.project.findFirst({ where: { id: projectId, ...visibleProjectWhere(user!) }, select: { id: true, name: true } });
  if (!project) notFound();
  return <main className="mx-auto max-w-4xl space-y-4 p-8">
    <PageBreadcrumbs pathname={`/projects/${projectId}/documents/chunks/${chunkId}`} items={[...projectBreadcrumbs(project, "文档").slice(0, 2), { label: "文档", href: `/projects/${projectId}/documents` }, { label: "文档引用详情" }]} />
    <Link href={`/projects/${projectId}/documents`} className="back-link text-teal-800 underline">← 返回项目文档</Link>
    <h1 className="text-2xl font-semibold">文档引用 · {chunk.document.filename}</h1>
    <p>解析版本 v{chunk.version} · 分块 {chunk.ordinal + 1} · {chunk.page === null ? "来源未提供页码" : `第 ${chunk.page} 页`}</p>
    {chunk.version !== chunk.document.parsedVersion && <p className="text-amber-800">这是保留的历史证据，当前成功版本为 v{chunk.document.parsedVersion}。</p>}
    <pre className="whitespace-pre-wrap break-words rounded border bg-slate-50 p-4">{chunk.text}</pre>
    <p className="break-all text-sm text-slate-600">分块 ID：{chunk.id}<br />文本 SHA-256：{chunk.textSha256}<br />来源：{chunk.blockIndex === null ? "Markdown" : `结构化块 ${chunk.blockIndex + 1}`}，字符范围 {chunk.startOffset}–{chunk.endOffset}（UTF-16，结束位置不包含）。</p>
    <a href={`/api/documents/${chunk.documentId}/download`} className="text-teal-800 underline">下载原始 PDF（记录下载审计）</a>
  </main>;
}
