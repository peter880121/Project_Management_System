"use client";
import { DependencyWarning } from "./task-lifecycle-menu";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlanActualSummary } from "./plan-actual-summary";
import { taskPhase, type TaskDetail } from "./board-types";
export function TaskReadonlyDrawer({ projectId, taskId, onClose }: { projectId: string; taskId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const request = useRef<AbortController | null>(null);
  const [task, setTask] = useState<TaskDetail | null>(null); const [error, setError] = useState("");
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setError("");
    try { const response = await fetch(`/api/tasks/${taskId}`, { cache: "no-store", signal: controller.signal }); const result = await response.json(); if (!response.ok || result.data?.id !== taskId) throw new Error(result.error || "详情读取失败"); if (!controller.signal.aborted) setTask(result.data); }
    catch (cause) { if (!controller.signal.aborted) { setTask(null); setError(cause instanceof Error ? cause.message : "详情读取失败"); } }
  }, [taskId]);
  useEffect(() => { const element = dialog.current; const previous = document.activeElement as HTMLElement | null; const overflow = document.body.style.overflow; element?.showModal(); document.body.style.overflow = "hidden"; void load(); return () => { request.current?.abort(); element?.close(); document.body.style.overflow = overflow; previous?.focus(); }; }, [load]);
  return <dialog ref={dialog} aria-labelledby="readonly-task-title" onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-0 ml-auto flex h-dvh max-h-none w-full max-w-[500px] flex-col border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/45">
    <header className="flex items-center justify-between border-b border-slate-200 p-5"><h2 id="readonly-task-title" className="font-semibold">任务详情（只读）</h2><button autoFocus type="button" aria-label="关闭任务详情" onClick={onClose} className="rounded-lg border-slate-200 px-3 py-1">关闭</button></header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      <p className="rounded-lg bg-teal-50 p-3 text-xs leading-6 text-teal-900">甘特图仅展示计划和执行结果。如需安排或执行任务，请前往任务管理。</p>
      {error && <p role="alert" className="text-sm text-red-800">{error}<button onClick={() => void load()} className="ml-3 underline">重新读取</button></p>}
      {!task && !error && <p role="status">正在加载任务详情…</p>}
      {task && <><div><p className="mb-2 text-xs text-teal-800">{taskPhase(task.description)} · <span className={task.status === "CANCELLED" ? "rounded bg-slate-200 px-2 py-1 text-slate-600" : ""}>{task.status === "CANCELLED" ? "已取消" : task.status}</span></p><h3 className="text-xl font-semibold">{task.title}</h3></div><p className="text-sm text-slate-600">负责人：{task.assignee?.name || "未分配"}</p><p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">{task.description || "暂无说明"}</p><DependencyWarning task={task} />{task.status === "CANCELLED" && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">已取消 · {task.cancelReason}</p>}<PlanActualSummary task={task} />
        <section><h4 className="text-sm font-semibold">前置任务</h4><ul className="mt-2 space-y-2 text-sm text-slate-600">{task.dependencies?.map(({ dependsOn }) => <li key={dependsOn.id}>{dependsOn.title} · {dependsOn.status}</li>)}</ul>{!task.dependencies?.length && <p className="mt-2 text-sm text-slate-500">无前置任务</p>}</section>
        {task.requiresDeliverable && <p className="text-sm text-amber-900">📎 需交付物 · 已批准 {task.deliverables?.length ?? 0} 项</p>}
        <section><h4 className="text-sm font-semibold">最近审计记录</h4><ul className="mt-2 space-y-2 text-xs text-slate-500">{task.audits.slice(-5).reverse().map(audit => <li key={audit.id}>{audit.action} · {audit.actor.name}</li>)}</ul></section>
        <Link className="inline-block rounded-lg bg-teal-800 px-4 py-2 text-sm text-white" href={`/projects/${projectId}/board?taskId=${encodeURIComponent(task.id)}`}>前往任务管理</Link>
      </>}
    </div>
  </dialog>;
}
