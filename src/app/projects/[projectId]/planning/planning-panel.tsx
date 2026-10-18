"use client";
import { taskPhase } from "@/modules/projects/task-phases";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/toast-provider";
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer";
import type { TaskChange } from "@/components/tasks/board-types";
import type { GanttMode, PlanningTask } from "@/modules/planning/gantt-adapter";
import type { PlanningGanttProps } from "@/components/planning/planning-gantt";
import { utcWeekStart, type MemberLoad } from "@/modules/planning/rules";
import { scheduleFormInput, scheduleValidationMessage } from "@/modules/planning/form-input";
type Task = PlanningTask;
const GanttView = dynamic<PlanningGanttProps>(() => import("@/components/planning/planning-gantt").catch(() => ({ default: function Unavailable({ onTable }: PlanningGanttProps) { return <div role="alert" className="rounded-lg bg-amber-50 p-4">图表加载失败，排期数据仍可在表格查看。<button onClick={onTable} className="ml-3">切换表格视图</button></div>; } })), { ssr: false, loading: () => <div role="status" aria-label="正在加载甘特图" className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></div> });
type Snapshot = { tasks: Task[]; loads: (MemberLoad & { projectCount: number; taskCount: number; incompleteTaskCount: number })[]; members: { id: string; name: string; status: string }[] };
export function PlanningPanel({ projectId, canManage, role, userId }: { projectId: string; canManage: boolean; role: string; userId: string }) {
  const { notify } = useToast();
  const [view, setView] = useState<"gantt" | "table">("gantt");
  const [mode, setMode] = useState<GanttMode>("Week");
  const [selected, setSelected] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const saving = useRef(false);
  const [week, setWeek] = useState(() => utcWeekStart().toISOString().slice(0, 10)); const [data, setData] = useState<Snapshot | null>(null); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    // One batched metadata request starts alongside planning. It never gates rendering.
    const phases = fetch(`/api/projects/${projectId}/tasks`, { cache: "no-store", signal: AbortSignal.timeout(5000) })
      .then(async response => {
        if (!response.ok) throw new Error("阶段数据加载失败");
        const body = await response.json() as { data: { id: string; description: string | null }[] };
        return new Map(body.data.map(task => [task.id, taskPhase(task.description)]));
      }).catch(() => null);
    try { const response = await fetch(`/api/projects/${projectId}/planning?weekStart=${week}`, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "加载失败"); if (current === generation.current) { setData(body.data); setStale(false);
      void phases.then(metadata => {
        if (current !== generation.current) return;
        if (!metadata) { notify("阶段信息暂时无法读取，任务按未分组展示；排期仍可使用", "error"); return; }
        setData(previous => previous && ({ ...previous, tasks: previous.tasks.map(task => ({ ...task, phase: metadata.get(task.id) ?? null })) }));
      }); } }
    catch (error) { if (current === generation.current) { setStale(true); setMessage(error instanceof Error ? error.message : "连接失败"); } throw error; }
  }, [projectId, week, notify]);
  useEffect(() => { void load().catch(() => {}); return invalidate; }, [load, invalidate]);
  async function save(url: string, method: string, body: unknown) {
    if (saving.current) throw new Error("正在保存排期，请稍候");
    saving.current = true;
    setBusy(true); setMessage("");
    let persisted = false;
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json();
      if (response.status === 409) {
        const message = url.endsWith("/schedule") && !String(result.error).includes("已完成") ? "排期版本已更新，请刷新后重试" : result.error || "数据已变化，请刷新后重试";
        setMessage(message); notify(message, "error");
        try { await load(); } catch { notify("最新排期读取失败，已暂停编辑，请刷新后重试", "error"); }
        throw new Error(message);
      }
      if (!response.ok) throw new Error(result.error || "保存失败");
      persisted = true;
      await load();
      setMessage("已保存并记录审计；请重新扫描风险查看最新判断。"); notify("排期已保存并记录审计");
    } catch (error) {
      const message = persisted ? "修改已保存，但刷新失败，已暂停编辑，请重新读取最新排期" : error instanceof Error ? error.message : "连接失败，请刷新核对排期";
      setMessage(message);
      if (message !== "排期版本已更新，请刷新后重试") notify(message, "error");
      if (persisted) setStale(true);
      throw error;
    } finally { saving.current = false; setBusy(false); }
  }
  async function updateTask(taskId: string, change: TaskChange) {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || "任务更新失败");
      notify("任务已更新并记录审计");
      try { await load(); } catch { notify("任务已保存，但排期刷新失败，请重试", "error"); }
    } catch (error) { notify(error instanceof Error ? error.message : "任务更新失败", "error"); throw error; }
  }
  function schedule(event: FormEvent<HTMLFormElement>, task: Task) {
    event.preventDefault();
    const input = scheduleFormInput(new FormData(event.currentTarget), task.scheduleVersion);
    const invalid = scheduleValidationMessage(input);
    if (invalid) { setMessage(`《${task.title}》：${invalid}`); return; }
    void save(`/api/tasks/${task.id}/schedule`, "PATCH", input).catch(() => {});
  }
  function capacity(event: FormEvent<HTMLFormElement>, load: MemberLoad) {
    event.preventDefault(); const value = String(new FormData(event.currentTarget).get("capacity") ?? "");
    void save(`/api/users/${load.userId}/capacity`, "PUT", { weekStart: week, expectedVersion: load.capacityVersion, hours: value ? Number(value) : null }).catch(() => {});
  }
  return <div className="space-y-6"><div className="flex flex-wrap items-end gap-3"><label className="block text-sm font-medium">统计周（周一）<input aria-label="统计周（周一）" type="date" disabled={busy} value={week} onChange={(event) => { generation.current++; setData(null); setWeek(event.target.value); }} className="mt-2 block h-11 w-full rounded-md border border-slate-300 bg-white px-3" /></label><button disabled={busy} onClick={() => void load().catch(() => {})} className="h-11 shrink-0 whitespace-nowrap rounded-md border border-slate-300 px-4">刷新排期</button><div aria-label="排期视图" className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">{(["gantt", "table"] as const).map(value => <button key={value} type="button" aria-pressed={view === value} disabled={busy} onClick={() => setView(value)} className={`rounded-md border-0 px-3 py-2 text-sm ${view === value ? "bg-teal-800 text-white" : "text-slate-600"}`}>{value === "gantt" ? "甘特图视图" : "表格视图"}</button>)}</div>{view === "gantt" && <label className="text-sm">时间粒度<select aria-label="甘特图时间粒度" value={mode} disabled={busy} onChange={event => setMode(event.target.value as GanttMode)} className="ml-2 h-10 rounded-md bg-white">{(["Day", "Week", "Month"] as const).map((value, index) => <option key={value} value={value}>{["日", "周", "月"][index]}</option>)}</select></label>}</div>
    {message && <p role="status" className="rounded border bg-slate-50 p-3">{message}</p>}
    {stale && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">排期数据尚未同步，已暂停编辑。请点击“刷新排期”重试。</p>}
    {!data && !stale && <div role="status" aria-label="正在加载排期" className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></div>}
    {data && <>{view === "gantt" && <><p className="text-xs text-slate-500">{canManage ? "拖动任务条调整日期；拖动两端调整起止日期。已完成任务只读，不会自动移动依赖任务。" : "当前角色为只读，可点击任务查看详情。"} 日期按 UTC 日历日保存；触屏可横向浏览，在表格中精确编辑。</p><GanttView tasks={data.tasks} mode={mode} canManage={canManage} busy={busy} stale={stale} onOpen={setSelected} onDateChange={(snapshot, dates) => save(`/api/tasks/${snapshot.id}/schedule`, "PATCH", dates)} onTable={() => setView("table")} /></>}{view === "table" && <section aria-label="任务排期" className="space-y-3"><h2 className="text-xl font-semibold">任务排期与前置依赖</h2>{data.tasks.length === 0 && <p>请先从看板创建任务。</p>}
      {data.tasks.map((task) => <article key={`${task.id}-${task.scheduleVersion}`} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5"><div><Link className="text-link block text-lg font-semibold text-teal-800 hover:underline" href={`/tasks/${task.id}`}>{task.title}</Link><p className="mt-3 text-sm text-slate-500">{task.status} · {task.assignee?.name ?? "未分配负责人"} · 排期版本 {task.scheduleVersion}</p></div>
        <form onSubmit={(event) => schedule(event, task)} className="space-y-4"><fieldset disabled={!canManage || busy || stale || task.status === "DONE"} className="space-y-4"><div className="grid gap-4 md:grid-cols-3"><label className="block text-sm font-medium">开始日期<input aria-label={`开始日期 ${task.title}`} name="start" type="date" defaultValue={task.plannedStartDate ?? ""} className="mt-2 block h-11 w-full rounded-md border border-slate-300 bg-white px-3" /></label><label className="block text-sm font-medium">截止日期<input aria-label={`截止日期 ${task.title}`} name="due" type="date" defaultValue={task.dueDate ?? ""} className="mt-2 block h-11 w-full rounded-md border border-slate-300 bg-white px-3" /></label><label className="block text-sm font-medium">预计工时<input aria-label={`预计工时 ${task.title}`} name="hours" type="number" min="0.01" max="10000" step="0.01" defaultValue={task.estimateHours ?? ""} className="mt-2 block h-11 w-full rounded-md border border-slate-300 bg-white px-3" /></label></div>
          <details><summary>选择前置任务（已选 {task.dependencyIds.length} 项）</summary><div className="mt-2 grid gap-2 md:grid-cols-2">{data.tasks.filter((row) => row.id !== task.id).map((row) => <label key={row.id} className="text-sm"><input name="dependency" type="checkbox" value={row.id} defaultChecked={task.dependencyIds.includes(row.id)} className="mr-2" />{row.title} · {row.status}</label>)}</div></details>
          {canManage && task.status !== "DONE" && <button disabled={busy} className="rounded bg-teal-800 px-3 py-2 text-white">保存排期</button>}
        </fieldset></form>{task.status === "DONE" && <p className="text-sm text-slate-500">已完成任务排期只读，避免改写历史延期依据。</p>}
      </article>)}
    </section>}<section aria-label="成员周容量" className="space-y-3"><h2 className="text-xl font-semibold">成员周容量与跨项目负载</h2><p className="text-sm">未完成任务使用全部预计工时计算，不扣减已执行工时。缺少日期或工时、已逾期但未重新排期的任务单独提示；统计不完整时不能据此认定没有超载。0 表示本周无可用工时，留空表示尚未配置。</p>
      <div className="grid gap-3 lg:grid-cols-2">{data.loads.map((row) => <article key={`${week}-${row.userId}-${row.capacityVersion}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-semibold text-slate-900">{row.name}</h3><p className="mt-2 text-sm leading-6 text-slate-600">计划工时 {row.plannedHours} 小时 · 容量 {row.capacityHours === null ? "未配置" : `${row.capacityHours} 小时`} · {row.overloaded === null ? "无法完整判断" : row.overloaded ? "超出容量" : "已统计工时未超容量"}</p><p className="mt-1 text-xs leading-6 text-slate-500">本周计入 {row.taskCount} 项任务，涉及 {row.projectCount} 个项目；另有 {row.incompleteTaskCount} 项相关任务排期不完整。其他项目仅显示汇总，不显示标识。</p>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => capacity(event, row)}><label className="block text-sm font-medium">本周容量<input name="capacity" aria-label={`本周容量 ${row.name}`} disabled={!canManage || busy || stale || data.members.find((member) => member.id === row.userId)?.status !== "ACTIVE"} type="number" min="0" max="168" step="0.01" defaultValue={row.capacityHours ?? ""} className="mt-2 block h-11 w-full rounded-md border border-slate-300 bg-white px-3" /></label>{canManage && data.members.find((member) => member.id === row.userId)?.status === "ACTIVE" && <button disabled={busy} className="h-11 shrink-0 whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-teal-800 hover:bg-teal-50">保存容量</button>}</form>
      </article>)}
    </div></section></>}
    {selected && <TaskDetailDrawer key={selected} taskId={selected} projectId={projectId} role={role} userId={userId} onClose={() => setSelected(null)} onUpdate={updateTask} onRefresh={load} />}
  </div>;
}
