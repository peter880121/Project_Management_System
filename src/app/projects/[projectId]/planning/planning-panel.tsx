"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskReadonlyDrawer } from "@/components/tasks/task-readonly-drawer";
import { usePlanningSnapshot } from "@/components/planning/use-planning-snapshot";
import type { PlanningGanttProps } from "@/components/planning/planning-gantt";
import type { GanttMode } from "@/modules/planning/gantt-adapter";
import { utcWeekStart } from "@/modules/planning/rules";
const GanttView = dynamic<PlanningGanttProps>(() => import("@/components/planning/planning-gantt").catch(() => ({ default: function Unavailable(props: PlanningGanttProps) { return <div role="alert" className="rounded-lg bg-amber-50 p-4 text-sm">图表加载失败，以下为只读任务列表。<ul className="mt-3 space-y-2">{props.tasks.map(task => <li key={task.id}><button onClick={() => props.onOpen(task.id)} className="text-teal-800 underline">{task.title}</button><span className="ml-3">{task.plannedStartDate || "待排期"} → {task.dueDate || "待排期"}</span></li>)}</ul></div>; } })), { ssr: false, loading: () => <Skeleton className="h-96 w-full" /> });
export function PlanningPanel({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState<GanttMode>("Week"); const [selected, setSelected] = useState<string | null>(null);
  const [week] = useState(() => utcWeekStart().toISOString().slice(0, 10));
  const { data, error, metadataError, loading, load } = usePlanningSnapshot(projectId, week, true);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">只读视图 · 计划日期、阶段与任务依赖</p><div className="flex items-center gap-3"><label className="text-sm">时间粒度<select aria-label="甘特图时间粒度" value={mode} onChange={event => setMode(event.target.value as GanttMode)} className="ml-2 rounded-lg border border-slate-200 bg-white p-2">{(["Day", "Week", "Month"] as const).map((value, index) => <option key={value} value={value}>{["日", "周", "月"][index]}</option>)}</select></label><button disabled={loading} onClick={() => void load().catch(() => {})} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">刷新甘特图</button></div></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {metadataError && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{metadataError}</p>}
    {!data && loading && <div role="status" aria-label="正在加载甘特图"><Skeleton className="h-96 w-full" /></div>}
    {data && <GanttView tasks={data.tasks} mode={mode} projectId={projectId} onOpen={setSelected} />}
    {selected && <TaskReadonlyDrawer key={selected} taskId={selected} projectId={projectId} onClose={() => setSelected(null)} />}
  </div>;
}
