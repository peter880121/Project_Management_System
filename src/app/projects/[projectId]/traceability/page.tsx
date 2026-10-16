import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { loadTraceability } from "@/modules/projects/repositories";
import { TraceabilityManager } from "./traceability-manager";
import { hasProjectAccess } from "@/modules/auth/project-access";

export const dynamic = "force-dynamic";
export default async function TraceabilityPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await getCurrentUser();
  if (requireRole(actor, ["ADMIN", "PM", "MEMBER", "QA"])) return <main className="p-8">请先登录查看追溯链。</main>;
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  if (!await hasProjectAccess(actor!, projectId)) notFound();
  const data = await loadTraceability(projectId);
  if (!data) notFound();
  return <main className="mx-auto max-w-5xl space-y-6 p-8">
    <Link className="text-teal-800 hover:underline" href={`/projects/${projectId}/board`}>← 返回项目看板</Link>
    <h1 className="text-3xl font-semibold">需求与测试追溯</h1>
    <p className="text-slate-600">仅使用合成数据。PM 维护需求和任务关联，QA 维护测试用例；修改会记录审计历史。</p>
    <TraceabilityManager projectId={projectId} role={actor!.role} initial={JSON.parse(JSON.stringify(data))} />
  </main>;
}
