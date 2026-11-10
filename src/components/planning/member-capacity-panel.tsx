"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";
import { useToast } from "@/components/toast-provider";
import { utcWeekStart, type MemberLoad } from "@/modules/planning/rules";
import { capacitySchema } from "@/modules/planning/schemas";
import { usePlanningSnapshot } from "./use-planning-snapshot";

export function MemberCapacityPanel({ projectId, revision = 0, onBusyChange }: { projectId: string; revision?: number; onBusyChange: (busy: boolean) => void }) {
  const { capabilities } = useProjectCapabilities(); const canManage = capabilities?.canSchedule === true;
  const { notify } = useToast();
  const [week, setWeek] = useState(() => utcWeekStart().toISOString().slice(0, 10));
  const { data, error, loading, load } = usePlanningSnapshot(projectId, week);
  const [busy, setBusy] = useState(false); const [blocked, setBlocked] = useState(false); const saving = useRef(false);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => { if (revision) void load().catch(() => {}); }, [revision, load]);
  async function save(event: FormEvent<HTMLFormElement>, row: MemberLoad) {
    event.preventDefault(); if (saving.current || !canManage) return;
    const value = String(new FormData(event.currentTarget).get("capacity") ?? "");
    const parsed = capacitySchema.safeParse({ weekStart: week, hours: value ? Number(value) : null, expectedVersion: row.capacityVersion });
    if (!parsed.success) { notify("请选择周一，容量需为 0–168 小时且最多两位小数", "error"); return; }
    saving.current = true; setBusy(true); let persisted = false;
    try {
      const response = await fetch(`/api/users/${row.userId}/capacity`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) await load(); throw new Error(result.error || "容量保存失败"); }
      persisted = true; await load(); notify("成员周容量已保存并记录审计");
    } catch (cause) { if (persisted) setBlocked(true); notify(persisted ? "容量已保存，但数据刷新失败，请重新读取" : cause instanceof Error ? cause.message : "容量保存失败", "error"); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section aria-label="成员周容量" className="space-y-4 border-t border-slate-200 pt-7">
    <div><h2 className="text-xl font-semibold">成员周容量与跨项目负载</h2><p className="mt-2 text-sm leading-7 text-slate-500">容量配置可稍后补充，不影响进入任务管理。留空代表未配置，0 代表本周无可用工时。跨项目仅展示负荷汇总。</p></div>
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm">统计周（周一）<input aria-label="统计周（周一）" type="date" disabled={busy} value={week} onChange={e => { setBlocked(false); setWeek(e.target.value); }} className="mt-2 block rounded-lg border border-slate-300 bg-white p-2" /></label><button disabled={busy || loading} onClick={() => void load().then(() => setBlocked(false)).catch(() => {})} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">刷新容量</button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {blocked && <p role="alert" className="text-sm text-amber-900">数据尚未同步，已暂停编辑，请刷新容量。</p>}
    {!data && loading && <p role="status">正在加载成员容量…</p>}
    <div className="grid gap-3 md:grid-cols-2">{data?.loads.map(row => <article key={`${week}:${row.userId}:${row.capacityVersion}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-semibold">{row.name}</h3><p className="mt-2 text-sm text-slate-600">计划工时 {row.plannedHours} 小时 · 容量 {row.capacityHours === null ? "未配置" : `${row.capacityHours} 小时`} · {row.overloaded === null ? "无法完整判断" : row.overloaded ? "超出容量" : "已统计工时未超容量"}</p><p className="mt-2 text-xs leading-6 text-slate-500">本周计入 {row.taskCount} 项任务，涉及 {row.projectCount} 个项目；另有 {row.incompleteTaskCount} 项相关任务排期不完整。</p>
      <form onSubmit={e => void save(e, row)} className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm">本周容量<input aria-label={`本周容量 ${row.name}`} name="capacity" type="number" min="0" max="168" step="0.01" defaultValue={row.capacityHours ?? ""} disabled={!canManage || busy || loading || blocked || data.members.find(member => member.id === row.userId)?.status !== "ACTIVE"} className="mt-2 block w-36 rounded-lg border border-slate-300 p-2" /></label>{canManage && data.members.find(member => member.id === row.userId)?.status === "ACTIVE" && <button disabled={busy || loading || blocked} className="rounded-lg bg-teal-800 px-3 py-2 text-sm text-white">保存容量</button>}</form>
    </article>)}</div>
  </section>;
}
