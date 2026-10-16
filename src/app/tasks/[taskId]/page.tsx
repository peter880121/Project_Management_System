import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { taskBreadcrumbs } from "@/components/layout/breadcrumbs";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }).format(date) + " UTC";
}

export default async function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return <main className="mx-auto max-w-4xl p-8"><h1 className="text-2xl font-semibold">请先登录查看任务</h1></main>;
  const { taskId } = await params;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      requirement: { include: { testCases: { select: { id: true, title: true, status: true } } } },
      dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
    },
  });
  if (!task) notFound();
  if (!await hasProjectAccess(user!, task.projectId)) notFound();
  const audits = await prisma.auditLog.findMany({
    where: { entityType: "Task", entityId: task.id },
    include: { actor: { select: { id: true, name: true, role: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return <main className="mx-auto min-h-screen max-w-4xl px-6 py-8">
    <PageBreadcrumbs pathname={`/tasks/${task.id}`} items={taskBreadcrumbs(task)} />
    <Link href={`/projects/${task.project.id}/board`} className="back-link text-sm text-teal-800 hover:underline">← {task.project.name} 看板</Link>
    <header className="mt-5 rounded-xl border border-slate-200 bg-white p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-slate-500">任务详情</p><h1 className="mt-2 text-3xl font-semibold">{task.title}</h1></div><span className="rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-900">{task.status}</span></div>
      <p className="mt-4 whitespace-pre-wrap text-slate-700">{task.description || "暂无任务说明"}</p><dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">负责人</dt><dd className="mt-1">{task.assignee?.name || "未分配"}</dd></div><div><dt className="text-slate-500">创建时间（UTC）</dt><dd className="mt-1">{formatDate(task.createdAt)}</dd></div><div><dt className="text-slate-500">建议工时</dt><dd className="mt-1">{task.estimateHours?.toString() ? `${task.estimateHours.toString()} 小时` : "未填写"}</dd></div><div><dt className="text-slate-500">实际工时</dt><dd className="mt-1">{task.actualHours?.toString() ? `${task.actualHours.toString()} 小时` : "任务未完成或未记录"}</dd></div>{task.completedAt && <div><dt className="text-slate-500">完成时间（UTC）</dt><dd className="mt-1">{formatDate(task.completedAt)}</dd></div>}</dl>
    </header>
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold">前置任务</h2>{task.dependencies.length === 0 ? <p className="mt-3 text-sm text-slate-500">此任务没有已采纳的前置任务。</p> : <ul className="mt-3 space-y-2">{task.dependencies.map((dependency) => <li key={dependency.dependsOn.id} className="flex justify-between gap-4 rounded-md border border-slate-200 px-3 py-2 text-sm"><Link className="text-link text-teal-800 hover:underline" href={`/tasks/${dependency.dependsOn.id}`}>{dependency.dependsOn.title}</Link><span className="text-slate-500">{dependency.dependsOn.status}</span></li>)}</ul>}</section>
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold">需求与测试追溯</h2>{task.requirement ? <><div className="mt-4 rounded-lg bg-slate-50 p-4"><p className="text-xs text-slate-500">关联需求</p><p className="mt-1 font-medium">{task.requirement.title}</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{task.requirement.content}</p></div><div className="mt-4"><h3 className="font-medium">关联测试用例</h3>{task.requirement.testCases.length === 0 ? <p className="mt-2 text-sm text-slate-500">该需求尚无测试用例。</p> : <ul className="mt-2 space-y-2">{task.requirement.testCases.map((testCase) => <li key={testCase.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm"><span>{testCase.title}</span><span className="text-slate-500">{testCase.status}</span></li>)}</ul>}</div></> : <p className="mt-3 text-sm text-slate-500">此任务尚未关联需求。</p>}</section>
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold">审计时间线</h2>{audits.length === 0 ? <p className="mt-3 text-sm text-slate-500">暂无审计记录。</p> : <ol className="mt-4 space-y-4 border-l border-slate-200 pl-5">{audits.map((entry) => <li key={entry.id} className="relative"><span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-teal-700"/><p className="font-medium">{entry.action} · {entry.actor.name}（{entry.actor.role}）</p><time className="mt-1 block text-xs text-slate-500">{formatDate(entry.createdAt)}</time><pre className="mt-2 overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}</pre></li>)}</ol>}</section>
  </main>;
}
