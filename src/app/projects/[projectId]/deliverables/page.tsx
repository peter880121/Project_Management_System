import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { DeliverablesPanel } from "@/components/assets/deliverables-panel";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const actor = await getCurrentUser(); if (!actor || !await hasProjectAccess(actor, projectId)) notFound();
  return <main className="mx-auto max-w-4xl space-y-6 px-6 py-8"><Link href={`/projects/${projectId}/board`} className="text-sm text-teal-800">← 返回项目看板</Link><div><h1 className="text-3xl font-semibold">交付物资产</h1><p className="mt-2 text-sm text-slate-500">文件独立版本、审批证据与 AI 索引状态。</p></div><DeliverablesPanel projectId={projectId} role={actor.role} userId={actor.id} /></main>;
}
