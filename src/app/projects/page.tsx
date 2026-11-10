import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderSearch, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { projectStatuses } from "@/modules/projects/status-display";
import { PROJECT_LIST_STATUSES, PROJECT_PAGE_SIZE, parseProjectListQuery, projectListUrl, type ProjectListParams } from "@/modules/projects/list-query";
import { listProjects } from "@/modules/projects/list-repository";
import { ProjectListFilters } from "@/components/projects/project-list-filters";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
export const dynamic = "force-dynamic";
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<ProjectListParams> }) {
  const user = await getCurrentUser(); const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied || !user) return <main className="mx-auto max-w-5xl p-8"><h1 className="text-2xl font-semibold">{denied?.status === 401 ? "请先登录" : "当前账号无权查看项目"}</h1></main>;
  const query = parseProjectListQuery(await searchParams); const result = await listProjects(user, query);
  if (query.page !== result.page) redirect(projectListUrl(query, { page: result.page }));
  const label = query.status ? projectStatuses[query.status].label : query.view === "all" ? "全部项目" : "当前项目";
  const currentCount = (result.counts.PLANNING ?? 0) + (result.counts.ACTIVE ?? 0);
  const options = [{ label: "当前项目", count: currentCount, status: null, view: "current" as const }, ...PROJECT_LIST_STATUSES.map(status => ({ label: projectStatuses[status].label, count: result.counts[status] ?? 0, status, view: "current" as const })), { label: "全部", count: result.allCount, status: null, view: "all" as const }];
  const returnTo = projectListUrl(query); const rangeStart = result.total ? (result.page - 1) * PROJECT_PAGE_SIZE + 1 : 0;
  return <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 sm:px-8">
    <PageBreadcrumbs pathname="/projects" items={[{ label: "项目" }]} />
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold tracking-widest text-teal-700">交付总览</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">项目看板</h1><p className="mt-2 text-sm leading-6 text-slate-500">聚焦规划与执行，随时查找历史交付。</p></div>{user.role === "PM" && <Link href="/projects/new" className="rounded-xl border-teal-800 bg-teal-800 px-4 py-2.5 text-sm font-medium text-white">创建项目</Link>}</header>
    {result.created && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">项目《{result.created.name}》创建成功，项目列表已更新。<Link href={`/projects/${result.created.id}/members?onboarding=1`} className="text-link ml-3 font-semibold underline">配置项目成员 →</Link></p>}
    <ProjectListFilters query={query} />
    <section aria-label="项目状态概览" className="mt-5 flex flex-wrap gap-2">{options.map(option => {
      const active = option.status ? query.status === option.status : !query.status && query.view === option.view;
      return <Link key={option.status ?? option.view} href={projectListUrl(query, { status: option.status, view: option.view, page: 1 })} aria-current={active ? "page" : undefined} className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs transition ${active ? "border-teal-800 bg-teal-800 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"}`}><span>{option.label}</span><span className={`rounded-full px-1.5 py-0.5 text-[11px] ${active ? "bg-white/15" : "bg-slate-100 text-slate-500"}`}>{option.count}</span></Link>;
    })}</section>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-semibold">{label} · 找到 {result.total} 个项目</h2><p className="mt-1 text-xs text-slate-500">{!query.status && query.view === "current" ? "仅展示规划中和进行中的项目。" : "按所选状态展示项目。"}{query.q ? `关键词：“${query.q}”；状态数量随搜索结果更新。` : ""}</p></div><p className="text-xs text-slate-400">{result.total ? `${rangeStart}–${Math.min(result.page * PROJECT_PAGE_SIZE, result.total)} / ${result.total}` : "暂无匹配项目"}</p></div>
    {!result.projects.length ? <section aria-label="项目空结果" className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-14 text-center"><FolderSearch aria-hidden="true" className="mx-auto size-9 text-teal-600/60" /><h3 className="mt-4 font-medium text-slate-800">当前范围没有匹配的项目</h3><p className="mt-2 text-sm text-slate-500">试试其他关键词，或扩大状态范围查找历史项目。</p><div className="mt-5 flex flex-wrap justify-center gap-4">{(query.status || query.view !== "all") && <Link href={projectListUrl(query, { status: null, view: "all", page: 1 })} className="text-link text-sm text-teal-800 underline">搜索全部状态</Link>}<Link href="/projects" className="text-link text-sm text-slate-500 underline">恢复默认</Link></div></section> :
      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="项目列表">{result.projects.map(project => {
        const href = `/projects/${project.id}/board${returnTo === "/projects" ? "" : `?${new URLSearchParams({ returnTo })}`}`;
        return <article key={project.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:border-teal-200 hover:shadow-md"><div className="flex items-center justify-between gap-2"><span className={`rounded-full border px-2.5 py-1 text-[11px] ${projectStatuses[project.status].color}`}>{projectStatuses[project.status].label}</span><span className="text-[11px] text-slate-400">{project.createdAt.toISOString().slice(0, 10)} 创建</span></div><h3 className="mt-4 line-clamp-2 min-h-14 break-words text-lg font-semibold leading-7"><Link href={href} className="text-link hover:text-teal-800 hover:underline">{project.name}</Link></h3><p className="mt-2 line-clamp-2 min-h-12 break-words text-sm leading-6 text-slate-500">{project.description || "暂无项目描述"}</p><footer className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4"><span className="text-xs text-slate-400">{project._count.tasks} 项有效任务</span><Link href={href} className="text-link inline-flex items-center gap-1 text-xs font-medium text-teal-800">查看任务<ArrowUpRight aria-hidden="true" className="size-3.5" /></Link></footer></article>;
      })}</section>}
    <nav aria-label="项目分页" className="mt-7 flex items-center justify-between gap-3 text-xs text-slate-500">{result.page > 1 ? <Link href={projectListUrl(query, { page: result.page - 1 })} className="inline-flex items-center gap-1 rounded-lg border-slate-200 bg-white px-3 py-2"><ChevronLeft className="size-3.5" />上一页</Link> : <span aria-disabled="true" className="px-3 py-2 text-slate-300">上一页</span>}<span>第 {result.page} / {result.pages} 页 · 每页 {PROJECT_PAGE_SIZE} 项</span>{result.page < result.pages ? <Link href={projectListUrl(query, { page: result.page + 1 })} className="inline-flex items-center gap-1 rounded-lg border-slate-200 bg-white px-3 py-2">下一页<ChevronRight className="size-3.5" /></Link> : <span aria-disabled="true" className="px-3 py-2 text-slate-300">下一页</span>}</nav>
  </main>;
}
