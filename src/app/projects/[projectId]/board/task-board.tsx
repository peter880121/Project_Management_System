"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ProjectNavigation } from "@/components/project-navigation";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";
type Task = { id: string; title: string; description: string | null; status: TaskStatus; assigneeId: string | null; assignee: { id: string; name: string } | null; requirement: { id: string; title: string } | null; dependencies?: { dependsOn: { id: string; title: string; status: TaskStatus } }[] };
type UserOption = { id: string; name: string; email: string };
const columns: { status: TaskStatus; title: string }[] = [
  { status: "TODO", title: "待办" }, { status: "IN_PROGRESS", title: "进行中" }, { status: "BLOCKED", title: "受阻" }, { status: "DONE", title: "已完成" },
];

export function TaskBoard({ project, role, userId, createdTaskId }: { project: { id: string; name: string }; role: string; userId: string; createdTaskId?: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [actualHours, setActualHours] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = role === "PM" || role === "ADMIN";
  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${project.id}/tasks`);
    const payload = await response.json() as { data?: Task[]; error?: string };
    if (!response.ok) { setError(payload.error || "任务加载失败"); return; }
    setTasks(payload.data || []);
  }, [project.id]);
  useEffect(() => { void load().catch(() => setError("任务列表暂时无法加载，请刷新重试")); }, [load]);
  useEffect(() => {
    if (role !== "PM") return;
    void fetch(`/api/users/options?projectId=${project.id}`).then(async (response) => {
      const payload = await response.json() as { data?: UserOption[] };
      if (response.ok) setUsers(payload.data || []);
      else setError("成员列表加载失败");
    }).catch(() => setError("成员列表加载失败"));
  }, [role, project.id]);

  async function update(task: Task, change: { status: TaskStatus; actualHours?: number } | { assigneeId: string | null }) {
    setError(""); setNotice("");
    const response = await fetch(`/api/tasks/${task.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setError(payload.error || "更新失败"); return; }
    setNotice("更新已保存并记录到审计时间线。"); await load();
  }
  function optionsFor(status: TaskStatus): TaskStatus[] {
    if (status === "TODO") return ["IN_PROGRESS", "BLOCKED"];
    if (status === "IN_PROGRESS") return ["TODO", "BLOCKED", "DONE"];
    if (status === "BLOCKED") return ["TODO", "IN_PROGRESS"];
    return canManage ? ["IN_PROGRESS"] : [];
  }

  return <main className="mx-auto min-h-screen max-w-7xl px-6 py-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><Link href="/projects" className="back-link text-sm text-teal-800 hover:underline">← 项目</Link><h1 className="mt-3 text-3xl font-semibold">{project.name}</h1><p className="mt-3 text-slate-600">任务看板 · 跟进待办、进行中、受阻与已完成的交付状态</p></div>{canManage && <Link href={`/projects/${project.id}/tasks/new`} className="inline-flex rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white">创建任务</Link>}</div>
    {createdTaskId && tasks.some(task => task.id === createdTaskId) && <p role="status" className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">任务《{tasks.find(task => task.id === createdTaskId)?.title}》创建成功，已加入下方看板并记录审计。</p>}
    <section aria-label="任务状态概览" className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">{columns.map(column => <div key={column.status} className={`rounded-xl border p-5 ${column.status === "BLOCKED" ? "border-amber-200 bg-amber-50" : column.status === "DONE" ? "border-emerald-200 bg-emerald-50" : column.status === "IN_PROGRESS" ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"}`}><p className="text-sm font-medium text-slate-600">{column.title}</p><p className="mt-2 text-3xl font-semibold">{tasks.filter(task => task.status === column.status).length}</p></div>)}</section>
    <ProjectNavigation projectId={project.id} role={role} />
    {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <section aria-label="任务看板" className="mt-6 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">{columns.map((column) => <div key={column.status} className="min-h-64 rounded-xl bg-slate-100 p-3"><h2 className="mb-3 flex items-center justify-between px-1 font-semibold">{column.title}<span className="text-sm font-normal text-slate-500">{tasks.filter((task) => task.status === column.status).length}</span></h2>
      <div className="space-y-3">{tasks.filter((task) => task.status === column.status).map((task) => <article key={task.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><Link href={`/tasks/${task.id}`} className="text-link font-medium text-slate-900 hover:text-teal-800 hover:underline">{task.title}</Link>{task.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{task.description}</p>}{task.requirement && <p className="mt-2 text-xs text-slate-500">需求：{task.requirement.title}</p>}<p className="mt-2 text-xs text-slate-500">负责人：{task.assignee?.name || "未分配"}</p>
        {role === "PM" && <label className="mt-3 block text-xs text-slate-600">分配负责人<select aria-label={`分配 ${task.title}`} value={task.assigneeId || ""} onChange={(event) => void update(task, { assigneeId: event.target.value || null })} className="mt-1 w-full rounded-md border border-slate-300 p-2"><option value="">未分配</option>{users.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>}
        {(canManage || (role === "MEMBER" && task.assigneeId === userId)) && optionsFor(task.status).length > 0 && <div className="mt-3 flex flex-wrap gap-2">{task.status === "IN_PROGRESS" && <label className="w-full text-xs text-slate-600">实际工时（完成任务时必填）<input aria-label={`实际工时 ${task.title}`} type="number" min="0.01" max="10000" step="0.01" value={actualHours[task.id] || ""} onChange={(event) => setActualHours((current) => ({ ...current, [task.id]: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label>}{optionsFor(task.status).map((status) => <button key={status} disabled={status === "DONE" && !(Number(actualHours[task.id]) > 0)} onClick={() => void update(task, status === "DONE" ? { status, actualHours: Number(actualHours[task.id]) } : { status })} className="rounded-md border border-teal-700 px-2 py-1 text-xs text-teal-800 hover:bg-teal-50">{status === "TODO" ? "退回待办" : status === "IN_PROGRESS" ? (task.status === "DONE" ? "重新打开" : "开始 / 恢复") : status === "BLOCKED" ? "标记受阻" : "完成"}</button>)}</div>}</article>)}{tasks.filter((task) => task.status === column.status).length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">暂无任务</p>}</div>
    </div>)}</section>
  </main>;
}
