"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { utcWeekStart, type MemberLoad } from "@/modules/planning/rules";
type Task = { id: string; title: string; status: string; assignee: { id: string; name: string } | null; plannedStartDate: string | null; dueDate: string | null; estimateHours: number | null; scheduleVersion: number; dependencyIds: string[] };
type Snapshot = { tasks: Task[]; loads: (MemberLoad & { projectCount: number; taskCount: number; incompleteTaskCount: number })[]; members: { id: string; name: string; status: string }[] };
export function PlanningPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [week, setWeek] = useState(() => utcWeekStart().toISOString().slice(0, 10)); const [data, setData] = useState<Snapshot | null>(null); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try { const response = await fetch(`/api/projects/${projectId}/planning?weekStart=${week}`); const body = await response.json(); if (!response.ok) throw new Error(body.error || "加载失败"); if (current === generation.current) setData(body.data); }
    catch (error) { if (current === generation.current) { setData(null); setMessage(error instanceof Error ? error.message : "连接失败"); } }
  }, [projectId, week]);
  useEffect(() => { void load(); }, [load]);
  async function save(url: string, method: string, body: unknown) {
    setBusy(true); setMessage("");
    try { const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "保存失败"); setMessage("已保存并记录审计；请重新扫描风险查看最新判断。"); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); }
  }
  function schedule(event: FormEvent<HTMLFormElement>, task: Task) {
    event.preventDefault(); const fields = new FormData(event.currentTarget); const start = String(fields.get("start") ?? ""); const due = String(fields.get("due") ?? ""); const hours = String(fields.get("hours") ?? "");
    void save(`/api/tasks/${task.id}/schedule`, "PATCH", { expectedVersion: task.scheduleVersion, plannedStartDate: start || null, dueDate: due || null, estimateHours: hours ? Number(hours) : null, dependencyIds: fields.getAll("dependency").map(String) });
  }
  function capacity(event: FormEvent<HTMLFormElement>, load: MemberLoad) {
    event.preventDefault(); const value = String(new FormData(event.currentTarget).get("capacity") ?? "");
    void save(`/api/users/${load.userId}/capacity`, "PUT", { weekStart: week, expectedVersion: load.capacityVersion, hours: value ? Number(value) : null });
  }
  return <div className="space-y-6"><div className="flex gap-3"><label>统计周（周一）<input aria-label="统计周（周一）" type="date" disabled={busy} value={week} onChange={(event) => { generation.current++; setData(null); setWeek(event.target.value); }} className="ml-2 rounded border p-2" /></label><button disabled={busy} onClick={() => void load()} className="rounded border px-3">刷新排期</button></div>
    {message && <p role="status" className="rounded border bg-slate-50 p-3">{message}</p>}
    {data && <><section aria-label="任务排期" className="space-y-3"><h2 className="text-xl font-semibold">任务排期与前置依赖</h2>{data.tasks.length === 0 && <p>请先从看板创建任务。</p>}
      {data.tasks.map((task) => <article key={`${task.id}-${task.scheduleVersion}`} className="space-y-3 rounded border p-4"><Link className="font-semibold text-teal-800 underline" href={`/tasks/${task.id}`}>{task.title}</Link><p className="text-sm">{task.status} · {task.assignee?.name ?? "未分配负责人"} · 排期版本 {task.scheduleVersion}</p>
        <form onSubmit={(event) => schedule(event, task)} className="space-y-3"><fieldset disabled={!canManage || busy || task.status === "DONE"} className="space-y-3"><div className="flex flex-wrap gap-4"><label>开始日期<input aria-label={`开始日期 ${task.title}`} name="start" type="date" defaultValue={task.plannedStartDate ?? ""} className="ml-2 rounded border p-2" /></label><label>截止日期<input aria-label={`截止日期 ${task.title}`} name="due" type="date" defaultValue={task.dueDate ?? ""} className="ml-2 rounded border p-2" /></label><label>预计工时<input aria-label={`预计工时 ${task.title}`} name="hours" type="number" min="0.01" max="10000" step="0.01" defaultValue={task.estimateHours ?? ""} className="ml-2 w-28 rounded border p-2" /></label></div>
          <details><summary>选择前置任务（已选 {task.dependencyIds.length} 项）</summary><div className="mt-2 grid gap-2 md:grid-cols-2">{data.tasks.filter((row) => row.id !== task.id).map((row) => <label key={row.id} className="text-sm"><input name="dependency" type="checkbox" value={row.id} defaultChecked={task.dependencyIds.includes(row.id)} className="mr-2" />{row.title} · {row.status}</label>)}</div></details>
          {canManage && task.status !== "DONE" && <button disabled={busy} className="rounded bg-teal-800 px-3 py-2 text-white">保存排期</button>}
        </fieldset></form>{task.status === "DONE" && <p className="text-sm text-slate-500">已完成任务排期只读，避免改写历史延期依据。</p>}
      </article>)}
    </section><section aria-label="成员周容量" className="space-y-3"><h2 className="text-xl font-semibold">成员周容量与跨项目负载</h2><p className="text-sm">未完成任务使用全部预计工时计算，不扣减已执行工时。缺少日期或工时、已逾期但未重新排期的任务单独提示；统计不完整时不能据此认定没有超载。0 表示本周无可用工时，留空表示尚未配置。</p>
      {data.loads.map((row) => <article key={`${week}-${row.userId}-${row.capacityVersion}`} className="rounded border p-4"><h3 className="font-semibold">{row.name}</h3><p>计划工时 {row.plannedHours} 小时 · 容量 {row.capacityHours === null ? "未配置" : `${row.capacityHours} 小时`} · {row.overloaded === null ? "无法完整判断" : row.overloaded ? "超出容量" : "已统计工时未超容量"}</p><p className="text-sm">本周计入 {row.taskCount} 项任务，涉及 {row.projectCount} 个项目；另有 {row.incompleteTaskCount} 项相关任务排期不完整。其他项目仅显示汇总，不显示标识。</p>
        <form className="mt-2 flex gap-3" onSubmit={(event) => capacity(event, row)}><label>本周容量<input name="capacity" aria-label={`本周容量 ${row.name}`} disabled={!canManage || busy || data.members.find((member) => member.id === row.userId)?.status !== "ACTIVE"} type="number" min="0" max="168" step="0.01" defaultValue={row.capacityHours ?? ""} className="ml-2 w-28 rounded border p-2" /></label>{canManage && data.members.find((member) => member.id === row.userId)?.status === "ACTIVE" && <button disabled={busy} className="rounded border px-3">保存容量</button>}</form>
      </article>)}
    </section></>}
  </div>;
}
