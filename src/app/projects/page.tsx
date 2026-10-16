import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { visibleProjectWhere } from "@/modules/auth/project-access";
import { projectStatuses } from "@/modules/projects/status-display";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string; created?: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return <main className="mx-auto max-w-5xl p-8"><h1 className="text-2xl font-semibold">请先登录</h1><p className="mt-2 text-slate-600">{denied.status === 401 ? "需要有效会话才能查看项目。" : "当前账号无权查看项目。"}</p></main>;
  const projects = await prisma.project.findMany({ where: visibleProjectWhere(user!), select: { id: true, name: true, description: true, status: true, _count: { select: { tasks: true } } }, orderBy: { name: "asc" } });
  const query = await searchParams;
  const status = query.status && Object.hasOwn(projectStatuses, query.status) ? query.status : "ALL";
  const filtered = status === "ALL" ? projects : projects.filter(project => project.status === status);
  const created = projects.find(project => project.id === query.created);
  return <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
    <PageBreadcrumbs pathname="/projects" items={[{ label: "项目" }]} />
    <div className="flex flex-wrap items-center justify-between gap-5"><div><p className="text-sm font-medium text-teal-700">交付总览</p><h1 className="mt-2 text-3xl font-semibold">项目看板</h1><p className="mt-3 text-slate-600">先看项目所处阶段，再进入项目跟进任务交付。</p></div>{user!.role === "PM" && <Link href="/projects/new" className="inline-flex rounded-md bg-teal-800 px-4 py-2 font-medium text-white">创建项目</Link>}</div>
    {created && <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">项目《{created.name}》创建成功，项目列表已更新。<Link href={`/projects/${created.id}/board`} className="text-link ml-3 font-semibold underline">进入项目 →</Link></p>}
    <section aria-label="项目状态概览" className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Object.entries(projectStatuses).map(([key, item]) => <Link key={key} href={`/projects?status=${key}`} aria-current={status === key ? "page" : undefined} className={`block rounded-xl border p-5 ${item.color} ${status === key ? "ring-2 ring-teal-700 ring-offset-2" : ""}`}><p className="text-sm font-medium">{item.label}</p><p className="mt-2 text-3xl font-semibold">{projects.filter(project => project.status === key).length}</p></Link>)}
    </section>
    <div className="mt-8 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">{status === "ALL" ? "全部项目" : projectStatuses[status as keyof typeof projectStatuses].label} · {filtered.length}</h2>{status !== "ALL" && <Link href="/projects" className="text-link text-sm text-teal-800 underline">查看全部项目</Link>}</div>
    {filtered.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">当前范围没有项目。</p> :
      <section className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-label="项目列表">{filtered.map(project => <article key={project.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <span className={`self-start rounded-full border px-3 py-1 text-xs font-medium ${projectStatuses[project.status].color}`}>{projectStatuses[project.status].label}</span>
        <h3 className="mt-4 text-lg font-semibold leading-7"><Link href={`/projects/${project.id}/board`} className="text-link hover:text-teal-800 hover:underline">{project.name}</Link></h3>
        <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{project.description || "暂无项目描述"}</p><div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4"><span className="text-sm text-slate-500">{project._count.tasks} 项任务</span><Link href={`/projects/${project.id}/board`} className="text-link text-sm font-semibold text-teal-800">查看任务 →</Link></div>
      </article>)}</section>}
  </main>;
}
