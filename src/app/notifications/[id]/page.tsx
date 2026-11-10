import { PageBackLink } from "@/components/page-back-link";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { getRiskNotificationDetail } from "@/modules/ai/risk/notifications";
import { PlanningError } from "@/modules/planning/schemas";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
export const dynamic = "force-dynamic";
export default async function NotificationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser(); if (requireRole(actor, ["PM"])) return <main className="p-8">请使用 PM 账号查看个人风险通知。</main>;
  const { id } = await params; if (!z.uuid().safeParse(id).success) notFound();
  const row = await getRiskNotificationDetail(id, actor!.id).catch((error) => { if (error instanceof PlanningError && error.status === 404) notFound(); throw error; });
  const output = row.suggestion.output; const parsed = z.object({ taskTitle: z.string(), taskId: z.uuid(), evidence: z.array(z.string()) }).safeParse(output);
  const statuses = { PENDING: "待 PM 处置", ACCEPTED: "已处理", REJECTED: "已忽略" };
  return <main className="mx-auto max-w-4xl space-y-4 p-8"><PageBreadcrumbs pathname={`/notifications/${id}`} items={[{ label: "我的风险通知", href: "/notifications" }, { label: "风险通知详情" }]} /><PageBackLink href="/notifications">返回我的通知</PageBackLink><h1 className="text-2xl font-semibold">风险通知详情</h1><p>{statuses[row.suggestion.status]} · 扫描时间 {row.suggestion.createdAt.toISOString()}</p><p>以下依据保留自生成建议时，不随当前排期变更而改写。通知已读与风险处置是两个独立操作。</p>{parsed.success ? <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">{parsed.data.taskTitle}</h2><ul className="list-disc space-y-2 pl-5">{parsed.data.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul><Link className="text-link text-teal-800 underline" href={`/tasks/${parsed.data.taskId}`}>查看关联任务当前状态</Link></section> : <p>原始风险依据格式无法读取，请联系管理员核对审计记录。</p>}<Link className="text-teal-800 underline" href={`/projects/${row.suggestion.projectId}/risks#risk-warnings`}>进入项目风险列表处置</Link></main>;
}
