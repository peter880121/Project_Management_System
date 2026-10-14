"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { WbsPanel } from "./wbs-panel";
import { RiskPanel } from "./risk-panel";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";
type Task = { id: string; title: string; description: string | null; status: TaskStatus; assigneeId: string | null; assignee: { id: string; name: string } | null; requirement: { id: string; title: string } | null; dependencies?: { dependsOn: { id: string; title: string; status: TaskStatus } }[] };
type UserOption = { id: string; name: string; email: string };
const columns: { status: TaskStatus; title: string }[] = [
  { status: "TODO", title: "待办" }, { status: "IN_PROGRESS", title: "进行中" }, { status: "BLOCKED", title: "受阻" }, { status: "DONE", title: "已完成" },
];

export function TaskBoard({ project, requirements, role, userId }: { project: { id: string; name: string }; requirements: { id: string; title: string }[]; role: string; userId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [title, setTitle] = useState("");
  const [requirementId, setRequirementId] = useState("");
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
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (role !== "PM") return;
    void fetch("/api/users/options").then(async (response) => {
      const payload = await response.json() as { data?: UserOption[] };
      if (response.ok) setUsers(payload.data || []);
      else setError("成员列表加载失败");
    }).catch(() => setError("成员列表加载失败"));
  }, [role]);

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const response = await fetch(`/api/projects/${project.id}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, ...(requirementId ? { requirementId } : {}) }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setError(payload.error || "任务创建失败"); return; }
    setTitle(""); setRequirementId(""); setNotice("任务已创建并写入审计记录。"); await load();
  }
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
    <div className="flex flex-wrap items-center justify-between gap-4"><div><Link href="/projects" className="text-sm text-teal-800 hover:underline">← 项目</Link><h1 className="mt-3 text-3xl font-semibold">{project.name}</h1><p className="mt-1 text-slate-600">任务看板 · 状态更新与审计记录同步保存</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm">{role}</span></div>
    {canManage && <form onSubmit={submitTask} className="mt-6 flex max-w-4xl flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4"><label htmlFor="new-task-title" className="sr-only">任务标题</label><input id="new-task-title" required maxLength={191} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入新任务名称" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2"/><label className="sr-only" htmlFor="new-task-requirement">关联需求</label><select id="new-task-requirement" value={requirementId} onChange={(event) => setRequirementId(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2"><option value="">不关联需求</option>{requirements.map((requirement) => <option key={requirement.id} value={requirement.id}>{requirement.title}</option>)}</select><button className="rounded-md bg-teal-800 px-4 py-2 font-medium text-white hover:bg-teal-900">创建任务</button></form>}
    {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {role === "PM" && <><WbsPanel projectId={project.id} onAccepted={load} /><RiskPanel projectId={project.id} /></>}
    <section aria-label="任务看板" className="mt-6 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">{columns.map((column) => <div key={column.status} className="min-h-64 rounded-xl bg-slate-100 p-3"><h2 className="mb-3 flex items-center justify-between px-1 font-semibold">{column.title}<span className="text-sm font-normal text-slate-500">{tasks.filter((task) => task.status === column.status).length}</span></h2>
      <div className="space-y-3">{tasks.filter((task) => task.status === column.status).map((task) => <article key={task.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><Link href={`/tasks/${task.id}`} className="font-medium text-slate-900 hover:text-teal-800 hover:underline">{task.title}</Link>{task.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{task.description}</p>}{task.requirement && <p className="mt-2 text-xs text-slate-500">需求：{task.requirement.title}</p>}<p className="mt-2 text-xs text-slate-500">负责人：{task.assignee?.name || "未分配"}</p>
        {role === "PM" && <label className="mt-3 block text-xs text-slate-600">分配负责人<select aria-label={`分配 ${task.title}`} value={task.assigneeId || ""} onChange={(event) => void update(task, { assigneeId: event.target.value || null })} className="mt-1 w-full rounded-md border border-slate-300 p-2"><option value="">未分配</option>{users.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>}
        {(canManage || (role === "MEMBER" && task.assigneeId === userId)) && optionsFor(task.status).length > 0 && <div className="mt-3 flex flex-wrap gap-2">{task.status === "IN_PROGRESS" && <label className="w-full text-xs text-slate-600">实际工时（完成任务时必填）<input aria-label={`实际工时 ${task.title}`} type="number" min="0.01" max="10000" step="0.01" value={actualHours[task.id] || ""} onChange={(event) => setActualHours((current) => ({ ...current, [task.id]: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label>}{optionsFor(task.status).map((status) => <button key={status} disabled={status === "DONE" && !(Number(actualHours[task.id]) > 0)} onClick={() => void update(task, status === "DONE" ? { status, actualHours: Number(actualHours[task.id]) } : { status })} className="rounded-md border border-teal-700 px-2 py-1 text-xs text-teal-800 hover:bg-teal-50">{status === "TODO" ? "退回待办" : status === "IN_PROGRESS" ? (task.status === "DONE" ? "重新打开" : "开始 / 恢复") : status === "BLOCKED" ? "标记受阻" : "完成"}</button>)}</div>}</article>)}{tasks.filter((task) => task.status === column.status).length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">暂无任务</p>}</div>
    </div>)}</section>
  </main>;
}
