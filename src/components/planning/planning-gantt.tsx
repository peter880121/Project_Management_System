"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createGantt } from "./gantt-instance";
import { planningTaskLabel, isPlottableTask, scheduledPlanningTasks, scheduleFromDrag, toGanttTasks, type GanttMode, type PlanningTask } from "@/modules/planning/gantt-adapter";
import type Gantt from "frappe-gantt";
import "./gantt-scoped.css";
import "./gantt-overrides.css";
import { phaseColorClass, PROJECT_PHASES, UNGROUPED_PHASE } from "@/modules/projects/task-phases";

export type PlanningGanttProps = { tasks: PlanningTask[]; mode: GanttMode; canManage: boolean; busy: boolean; stale: boolean; onOpen: (id: string) => void; onDateChange: (snapshot: PlanningTask, dates: ReturnType<typeof scheduleFromDrag>) => Promise<void>; onTable: () => void };
export default function PlanningGantt(props: PlanningGanttProps) {
  const latest = useRef(props); latest.current = props;
  const host = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const instance = useRef<Gantt | null>(null);
  const snapshots = useRef(new Map<string, PlanningTask>());
  const pending = useRef(false);
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(0);
  const positionedMode = useRef<GanttMode | null>(null);
  const dragging = useRef(false);
  const deferredRefresh = useRef(false);
  const [interactionVersion, setInteractionVersion] = useState(0);
  const [error, setError] = useState("");
  const redraw = useCallback(() => {
    const gantt = instance.current; if (!gantt) return;
    const { scrollLeft, scrollTop } = gantt.$container;
    gantt.refresh(toGanttTasks(latest.current.tasks));
    gantt.$container.scrollLeft = scrollLeft; gantt.$container.scrollTop = scrollTop;
    gantt.$svg.querySelectorAll<SVGGElement>(".bar-wrapper").forEach(element => {
      const task = latest.current.tasks.find(row => row.id === element.dataset.id);
      element.setAttribute("role", "button"); element.setAttribute("tabindex", "0");
      element.setAttribute("aria-label", `查看任务：${task?.title ?? "任务"}`);
    });
  }, []);
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    positionedMode.current = null;
    let dispose: (() => void) | undefined;
    const down = (event: MouseEvent) => {
      const target = (event.target as Element).closest<SVGGElement>(".bar-wrapper");
      if (!target) return;
      pointer.current = { x: event.clientX, y: event.clientY, moved: false };
      const task = latest.current.tasks.find(row => row.id === target.dataset.id);
      if (!task || !latest.current.canManage || latest.current.busy || latest.current.stale || pending.current || task.status === "DONE") { event.preventDefault(); event.stopImmediatePropagation(); return; }
      dragging.current = true;
      snapshots.current.set(task.id, { ...task, dependencyIds: [...task.dependencyIds] });
    };
    const move = (event: MouseEvent) => { if (pointer.current && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 5) pointer.current.moved = true; };
    const click = (event: MouseEvent) => { if (pointer.current?.moved || Date.now() < suppressClick.current) { event.preventDefault(); event.stopImmediatePropagation(); } pointer.current = null; };
    const up = () => {
      dragging.current = false;
      if (pointer.current?.moved && !pending.current) redraw();
      if (deferredRefresh.current) { deferredRefresh.current = false; setInteractionVersion(value => value + 1); }
    };
    const key = (event: KeyboardEvent) => { if (["Enter", " "].includes(event.key)) { const id = (event.target as Element).closest<SVGGElement>(".bar-wrapper")?.dataset.id; if (id) { event.preventDefault(); latest.current.onOpen(id); } } };
    const sync = () => { if (instance.current && list.current) list.current.scrollTop = instance.current.$container.scrollTop; };
    try {
      const result = createGantt(element, toGanttTasks(latest.current.tasks), { view_mode: latest.current.mode, view_modes: ["Day", "Week", "Month"], readonly_dates: !latest.current.canManage, readonly_progress: true, move_dependencies: false, snap_at: "1d", popup: false, container_height: 480, bar_height: 30, padding: 18, upper_header_height: 32, lower_header_height: 28, today_button: false, view_mode_select: false, infinite_padding: false, scroll_to: "start", language: "zh",
        on_click: task => { if (!pointer.current?.moved && Date.now() >= suppressClick.current) latest.current.onOpen(task.id); },
        on_date_change: (task, start, end) => {
          const snapshot = snapshots.current.get(task.id);
          suppressClick.current = Date.now() + 300;
          if (!snapshot || pending.current || latest.current.busy || latest.current.stale || !latest.current.canManage || snapshot.status === "DONE") { redraw(); return; }
          pending.current = true;
          void latest.current.onDateChange(snapshot, scheduleFromDrag(snapshot, start, end)).catch(() => { redraw(); }).finally(() => { pending.current = false; snapshots.current.delete(task.id); });
        },
      });
      instance.current = result.gantt; dispose = result.dispose;
      instance.current.$container.addEventListener("scroll", sync);
      element.addEventListener("mousedown", down, true); element.addEventListener("mousemove", move, true); element.addEventListener("click", click, true); element.addEventListener("keydown", key);
      document.addEventListener("mouseup", up);
      redraw();
    } catch { setError("甘特图暂时无法加载，请使用表格维护排期"); }
    return () => { instance.current?.$container.removeEventListener("scroll", sync); element.removeEventListener("mousedown", down, true); element.removeEventListener("mousemove", move, true); element.removeEventListener("click", click, true); element.removeEventListener("keydown", key); document.removeEventListener("mouseup", up); dispose?.(); instance.current = null; };
  }, [redraw]);
  useEffect(() => {
    const gantt = instance.current; if (!gantt) return;
    // Late phase metadata must not replace native SVG nodes during an active drag.
    if (dragging.current) { deferredRefresh.current = true; return; }
    gantt.update_options({ readonly_dates: !props.canManage }); gantt.change_view_mode(props.mode, true); redraw();
    if (positionedMode.current !== props.mode) {
      // Position after every native re-render in the mode change, avoiding its padding month.
      const bars = Array.from(gantt.$svg.querySelectorAll<SVGRectElement>(".bar-wrapper .bar"));
      if (bars.length) gantt.$container.scrollLeft = Math.max(0, Math.min(...bars.map(bar => Number(bar.getAttribute("x")))) - 24);
      positionedMode.current = props.mode;
    }
  }, [props.tasks, props.mode, props.canManage, redraw, interactionVersion]);
  const scheduled = scheduledPlanningTasks(props.tasks);
  const unplanned = props.tasks.filter(task => !isPlottableTask(task));
  const phaseNames = [...new Set(props.tasks.map(task => task.phase ?? UNGROUPED_PHASE))];
  const phases = [...PROJECT_PHASES.filter(phase => phaseNames.includes(phase)), ...phaseNames.filter(phase => !PROJECT_PHASES.includes(phase))];
  return <section aria-label="项目甘特图" className="space-y-3">
    <div aria-label="交付阶段图例" className="medpm-gantt-legend flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[11px] text-slate-600"><span className="font-semibold text-slate-800">交付阶段</span>{phases.map(phase => <span key={phase} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`size-2.5 rounded-sm ${phaseColorClass(phase)}`} />{phase}</span>)}<span className="ml-auto text-slate-400">已完成任务为灰色</span></div>
    {error ? <div role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{error}<button type="button" onClick={props.onTable} className="ml-3">切换表格视图</button></div> : <div className="medpm-gantt flex overflow-hidden rounded-xl border border-slate-200 bg-white">
      <aside className="w-40 shrink-0 border-r border-slate-200 sm:w-64"><div className="flex h-[70px] items-center border-b border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600">任务 · 开始 / 截止</div><div ref={list} aria-label="甘特任务列表" onScroll={() => { if (instance.current && list.current) instance.current.$container.scrollTop = list.current.scrollTop; }} className="h-[410px] overflow-y-auto pb-2 [scrollbar-width:none]">{scheduled.map(task => <button key={task.id} type="button" aria-label={task.title} onClick={() => props.onOpen(task.id)} className="flex h-12 w-full flex-col justify-center rounded-none border-x-0 border-t-0 border-slate-100 px-3 py-0 text-left hover:bg-teal-50"><span className="w-full truncate text-xs font-medium text-slate-800" title={planningTaskLabel(task)}>{planningTaskLabel(task)}</span><span className="mt-1 text-[10px] text-slate-500">{task.plannedStartDate?.slice(5)} → {task.dueDate?.slice(5)}</span></button>)}</div></aside>
      <div ref={host} className="min-w-0 flex-1" />
    </div>}
    {!scheduled.length && !error && <p className="text-sm text-slate-500">暂无完整排期，请在表格视图设置开始和截止日期。</p>}
    {unplanned.length > 0 && <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4"><h3 className="text-sm font-semibold">未排期或超出图表范围（{unplanned.length}）</h3><p className="mt-1 text-xs text-slate-500">缺少日期或跨度超过 10 年的任务不绘制时间条；涉及这些任务的依赖请在表格核对。</p><div className="mt-3 flex flex-wrap gap-2">{unplanned.map(task => <button key={task.id} type="button" aria-label={task.title} onClick={() => props.onOpen(task.id)} className="rounded-md border-slate-200 bg-white px-2 py-1 text-xs text-teal-800">{planningTaskLabel(task)}</button>)}<button type="button" onClick={props.onTable} className="border-0 p-1 text-xs text-teal-800 underline">前往表格设置排期</button></div></div>}
  </section>;
}
