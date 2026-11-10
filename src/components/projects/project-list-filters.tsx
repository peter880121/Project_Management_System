import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { projectListUrl, type ProjectListQuery } from "@/modules/projects/list-query";
export function ProjectListFilters({ query }: { query: ProjectListQuery }) {
  return <form key={`${query.q}:${query.sort}:${query.view}:${query.status}`} action="/projects" method="get" aria-label="查找项目" className="mt-7 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <input type="hidden" name={query.status ? "status" : "view"} value={query.status ?? query.view} />
    <label className="min-w-0 flex-1 basis-64 text-xs font-medium text-slate-600">搜索项目<div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:border-teal-500"><Search aria-hidden="true" className="size-4 shrink-0 text-slate-400" /><input aria-label="项目搜索关键词" type="search" name="q" defaultValue={query.q} maxLength={100} placeholder="搜索项目名称或描述…" className="min-w-0 w-full bg-transparent py-2.5 text-sm outline-none" /></div></label>
    <label className="text-xs font-medium text-slate-600"><span className="inline-flex items-center gap-1"><SlidersHorizontal aria-hidden="true" className="size-3" />排序</span><select aria-label="项目排序" name="sort" defaultValue={query.sort} className="mt-2 block rounded-xl border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"><option value="created_desc">最近创建优先</option><option value="name_asc">项目名称 A–Z</option></select></label>
    <button type="submit" className="rounded-xl border-teal-800 bg-teal-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-900">搜索</button>
    {query.q && <Link href={projectListUrl(query, { q: "", page: 1 })} className="text-link py-2.5 text-xs text-slate-500 underline">清空关键词</Link>}
    <Link href="/projects" className="text-link py-2.5 text-xs text-slate-500 underline">恢复默认</Link>
  </form>;
}
