import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { MeetingsManager } from "@/components/assets/meetings-manager";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const actor = await getCurrentUser(); if (!actor || !await hasProjectAccess(actor, projectId)) notFound();
  return <main className="mx-auto max-w-6xl space-y-6 px-6 py-8"><Link href={`/projects/${projectId}/board`} className="text-sm text-teal-800">← 返回项目看板</Link><div><h1 className="text-3xl font-semibold tracking-tight">会议纪要</h1><p className="mt-2 text-sm text-slate-500">让决策、共识与行动项成为可追溯的交付资产。</p></div><MeetingsManager projectId={projectId} role={actor.role} /></main>;
}
