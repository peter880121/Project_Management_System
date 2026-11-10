import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { PageBackLink } from "@/components/page-back-link";
import { RequirementsWorkspace } from "@/components/requirements/workspace";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const actor = await getCurrentUser();
  if (!z.uuid().safeParse(projectId).success || !actor || !await hasProjectAccess(actor, projectId)) notFound();
  return <main className="mx-auto w-full max-w-7xl space-y-6 px-6 py-8"><PageBackLink href={`/projects/${projectId}/board`}>返回任务看板</PageBackLink><header><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-teal-700">Requirements Management</p><h1 className="text-3xl font-semibold tracking-tight">需求管理</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">持续受理客户建议，明确范围与验收标准，追踪实施、验证和客户确认。从项目建设到后期维护，让每一次需求变化都有依据。</p></header><Suspense fallback={<p>正在加载需求管理…</p>}><RequirementsWorkspace projectId={projectId} role={actor.role} userId={actor.id} /></Suspense></main>;
}
