import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return <main className="mx-auto max-w-5xl p-8"><h1 className="text-2xl font-semibold">请先登录</h1><p className="mt-2 text-slate-600">{denied.status === 401 ? "需要有效会话才能查看项目。" : "当前账号无权查看项目。"}</p></main>;
  const projects = await prisma.project.findMany({ select: { id: true, name: true, description: true, status: true, _count: { select: { tasks: true } } }, orderBy: { name: "asc" } });
  return <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
    <Link href="/" className="text-sm text-teal-800 hover:underline">MedPM-AI</Link>
    <h1 className="mt-5 text-3xl font-semibold">项目看板</h1>
    <p className="mt-2 text-slate-600">选择项目查看任务流转与审计追踪。</p>
    {projects.length === 0 ? <p className="mt-8 rounded-xl border border-slate-200 bg-white p-6 text-slate-600">目前没有项目，请先创建项目数据。</p> :
      <section className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-label="项目列表">{projects.map((project) => <Link key={project.id} href={`/projects/${project.id}/board`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-teal-600">
        <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{project.name}</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{project.status}</span></div>
        <p className="mt-3 line-clamp-2 min-h-12 text-sm text-slate-600">{project.description || "暂无项目描述"}</p><p className="mt-4 text-sm text-teal-800">{project._count.tasks} 项任务 →</p>
      </Link>)}</section>}
  </main>;
}
