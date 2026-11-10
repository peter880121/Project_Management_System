"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type Gantt from "frappe-gantt";
import { createGantt } from "./gantt-instance";
import { planningTaskLabel, isPlottableTask, scheduledPlanningTasks, toGanttTasks, type GanttMode, type PlanningTask } from "@/modules/planning/gantt-adapter";
import { phaseColorClass, PROJECT_PHASES, UNGROUPED_PHASE } from "@/modules/projects/task-phases";
export type PlanningGanttProps = { tasks: PlanningTask[]; mode: GanttMode; projectId: string; onOpen: (id: string) => void };
export default function PlanningGantt(props: PlanningGanttProps) {
  const latest = useRef(props); latest.current = props;
  const host = useRef<HTMLDivElement>(null); const list = useRef<HTMLDivElement>(null); const instance = useRef<Gantt | null>(null);
  const positioned = useRef<GanttMode | null>(null); const [error, setError] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const element = host.current; let dispose: (() => void) | undefined;
    const sync = () => { if (instance.current && list.current) list.current.scrollTop = instance.current.$container.scrollTop; };
    const key = (event: KeyboardEvent) => { const id = (event.target as Element).closest<SVGGElement>(".bar-wrapper")?.dataset.id; if (id && ["Enter", " "].includes(event.key)) { event.preventDefault(); latest.current.onOpen(id); } };
    try {
      if (getComputedStyle(element).getPropertyValue("--medpm-gantt-css-ready").trim() !== "1") throw new Error("Gantt stylesheet unavailable");
      const result = createGantt(element, toGanttTasks(latest.current.tasks), { view_mode: latest.current.mode, view_modes: ["Day", "Week", "Month"], readonly_dates: true, readonly_progress: true, move_dependencies: false, popup: false, container_height: 480, bar_height: 30, padding: 18, upper_header_height: 32, lower_header_height: 28, today_button: false, view_mode_select: false, infinite_padding: false, scroll_to: "start", language: "zh", on_click: task => latest.current.onOpen(task.id) });
      instance.current = result.gantt; dispose = result.dispose; instance.current.$container.addEventListener("scroll", sync); element.addEventListener("keydown", key);
    } catch { setError(true); }
    return () => { instance.current?.$container.removeEventListener("scroll", sync); element.removeEventListener("keydown", key); dispose?.(); instance.current = null; };
  }, []);
  useEffect(() => {
    const gantt = instance.current; if (!gantt) return;
    try {
    const scroll = { left: gantt.$container.scrollLeft, top: gantt.$container.scrollTop };
    gantt.change_view_mode(props.mode, true); gantt.refresh(toGanttTasks(props.tasks));
    gantt.$container.scrollLeft = scroll.left; gantt.$container.scrollTop = scroll.top;
    gantt.$svg.querySelectorAll<SVGGElement>(".bar-wrapper").forEach(element => { const task = props.tasks.find(row => row.id === element.dataset.id); element.setAttribute("role", "button"); element.setAttribute("tabindex", "0"); element.setAttribute("aria-label", `查看任务：${task?.title ?? "任务"}`); });
    if (positioned.current !== props.mode) { const bars = [...gantt.$svg.querySelectorAll<SVGRectElement>(".bar-wrapper .bar")]; if (bars.length) gantt.$container.scrollLeft = Math.max(0, Math.min(...bars.map(bar => Number(bar.getAttribute("x")))) - 24); positioned.current = props.mode; }
    } catch { setError(true); }
  }, [props.tasks, props.mode]);
  const scheduled = scheduledPlanningTasks(props.tasks); const unplanned = props.tasks.filter(task => task.status !== "CANCELLED" && !isPlottableTask(task));
  const names = [...new Set(props.tasks.map(task => task.phase ?? UNGROUPED_PHASE))]; const phases = [...PROJECT_PHASES.filter(phase => names.includes(phase)), ...names.filter(phase => !PROJECT_PHASES.includes(phase))];
  return <section aria-label="项目甘特图" className="space-y-3">
    <div aria-label="交付阶段图例" className="medpm-gantt-legend flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[11px] text-slate-600"><span className="font-semibold text-slate-800">交付阶段</span>{phases.map(phase => <span key={phase} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`size-2.5 rounded-sm ${phaseColorClass(phase)}`} />{phase}</span>)}<span className="ml-auto text-slate-400">已完成为灰色 · 已取消为浅灰删除线</span></div>
    {error ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">甘特图暂时无法加载，以下为只读任务列表。<ul className="mt-3 space-y-2">{props.tasks.map(task => <li key={task.id}><button onClick={() => props.onOpen(task.id)} className="text-teal-800 underline">{planningTaskLabel(task)}</button> · {task.plannedStartDate || "待排期"} → {task.dueDate || "待排期"}</li>)}</ul></div> : <div className="medpm-gantt flex overflow-hidden rounded-xl border border-slate-200 bg-white"><aside className="w-40 shrink-0 border-r border-slate-200 sm:w-64"><div className="flex h-[70px] items-center border-b border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600">任务 · 开始 / 截止</div><div ref={list} aria-label="甘特任务列表" onScroll={() => { if (instance.current && list.current) instance.current.$container.scrollTop = list.current.scrollTop; }} className="h-[410px] overflow-y-auto pb-2 [scrollbar-width:none]">{scheduled.map(task => <button key={task.id} type="button" aria-label={task.title} onClick={() => props.onOpen(task.id)} className="flex h-12 w-full flex-col justify-center rounded-none border-x-0 border-t-0 border-slate-100 px-3 py-0 text-left hover:bg-teal-50"><span className="w-full truncate text-xs font-medium text-slate-800" title={planningTaskLabel(task)}>{planningTaskLabel(task)}</span><span className="mt-1 text-[10px] text-slate-500">{task.plannedStartDate?.slice(5)} → {task.dueDate?.slice(5)}</span></button>)}</div></aside><div ref={host} className="min-w-0 flex-1" /></div>}
    {!scheduled.length && !error && <p className="text-sm text-slate-500">暂无完整计划。请在任务管理中设置开始日期、完成日期和预计工时。</p>}
    {unplanned.length > 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4"><h3 className="text-sm font-semibold">待排期或超出图表范围（{unplanned.length}）</h3><p className="mt-2 text-xs leading-6 text-slate-500">缺少日期、工时或跨度超过 10 年的任务不绘制时间条，也不生成经过它们的依赖连线。请在任务管理中补齐计划。</p><div className="mt-3 flex flex-wrap gap-2">{unplanned.map(task => <button key={task.id} aria-label={task.title} onClick={() => props.onOpen(task.id)} className="rounded-md border-slate-200 bg-white px-2 py-1 text-xs text-teal-800">{planningTaskLabel(task)}</button>)}</div><Link href={`/projects/${props.projectId}/board`} className="mt-3 inline-block text-xs text-teal-800 underline">前往任务管理安排计划 →</Link></div>}
    {props.tasks.some(task => task.status === "CANCELLED" && !isPlottableTask(task)) && <details className="rounded-xl border border-slate-200 bg-slate-50 p-4"><summary className="cursor-pointer text-sm text-slate-500">未排期的已取消记录</summary><div className="mt-3 flex flex-wrap gap-2">{props.tasks.filter(task => task.status === "CANCELLED" && !isPlottableTask(task)).map(task => <button key={task.id} type="button" onClick={() => props.onOpen(task.id)} className="rounded-md bg-slate-200 px-3 py-2 text-xs text-slate-500 line-through">{planningTaskLabel(task)}</button>)}</div></details>}
  </section>;
}
