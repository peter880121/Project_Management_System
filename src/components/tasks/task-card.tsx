"use client";
import Link from "next/link";
import { useRef } from "react";
import { Play, Pause, RotateCcw, Check, UserRound } from "lucide-react";
import { TaskAiActions } from "../task-ai-actions";
import { canUpdateTask, taskPhase, taskStatusOptions, type BoardTask, type TaskStatus } from "./board-types";

export const statusLabels: Record<TaskStatus, string> = { TODO: "退回待办", IN_PROGRESS: "开始 / 恢复", BLOCKED: "标记受阻", DONE: "完成" };
export function TaskCard({ task, role, userId, busy, onOpen, onStatus }: { task: BoardTask; role: string; userId: string; busy: boolean; onOpen: (mode?: "wbs" | "compliance") => void; onStatus: (status: TaskStatus) => void }) {
  const phase = taskPhase(task.description);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  return <article tabIndex={0} aria-label={`任务卡片：${task.title}`} data-task-card={task.id} onPointerDown={event => { pointer.current = { x: event.clientX, y: event.clientY }; }} onClick={event => { if (pointer.current && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 5) return; onOpen(); }} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); onOpen(); } }} className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-teal-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">
    {phase && <span className="mb-2 inline-block rounded bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800">{phase}</span>}
    <Link href={`/tasks/${task.id}`} aria-haspopup="dialog" onClick={event => { event.preventDefault(); event.stopPropagation(); if (pointer.current && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 5 && event.detail !== 0) return; onOpen(); }} className="line-clamp-2 border-0 p-0 text-sm font-semibold leading-5 text-slate-900 hover:text-teal-800">{task.title}</Link>
    {task.description && <p className="mt-1 line-clamp-1 text-xs leading-5 text-slate-500">{task.description.split("\n").filter(line => !line.startsWith("所属阶段：")).join(" ") || task.description}</p>}
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
      <button type="button" title={`负责人：${task.assignee?.name || "未分配"}`} aria-label={`负责人：${task.assignee?.name || "未分配"}`} onClick={event => { event.stopPropagation(); onOpen(); }} className="flex size-8 shrink-0 items-center justify-center rounded-full border-slate-200 bg-slate-50 p-0 text-xs font-semibold text-slate-600">{task.assignee?.name.slice(0, 1) || <UserRound aria-hidden="true" className="size-4" />}</button>
      <div className="flex flex-wrap items-center justify-end gap-1.5"><TaskAiActions compact task={task} role={role} onSelect={selection => onOpen(selection.mode)} />
        {canUpdateTask(task, role, userId) && taskStatusOptions(task.status, role).map(status => {
          const Icon = status === "IN_PROGRESS" ? Play : status === "BLOCKED" ? Pause : status === "DONE" ? Check : RotateCcw;
          const label = task.status === "DONE" && status === "IN_PROGRESS" ? "重新打开" : statusLabels[status];
          return <button key={status} type="button" title={label} aria-label={label} disabled={busy} onClick={event => { event.stopPropagation(); if (status === "DONE") onOpen(); else onStatus(status); }} className="inline-flex size-8 items-center justify-center rounded-md border-slate-200 p-0 text-slate-500 hover:bg-teal-50 hover:text-teal-800 disabled:opacity-40"><Icon aria-hidden="true" className="size-3.5" /></button>;
        })}
      </div>
    </div>
  </article>;
}
