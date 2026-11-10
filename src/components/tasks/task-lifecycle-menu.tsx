"use client";
import { useEffect, useRef, useState } from "react";
import type { BoardTask, TaskChange } from "./board-types";
import { taskCancelSchema } from "@/modules/tasks/lifecycle-schema";
import { ToastViewport, useDialogToasts } from "@/components/toast-provider";

export function DependencyWarning({ task }: { task: Pick<BoardTask, "dependencies" | "status"> }) {
  if (task.status === "CANCELLED" || !task.dependencies?.some(edge => edge.dependsOn.status === "CANCELLED")) return null;
  return <p role="alert" className="my-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold leading-5 text-amber-900">⚠ 前置任务已被取消，请重新评估依赖</p>;
}
export function TaskLifecycleMenu({ task, role, disabled, onChange }: { task: BoardTask; role: string; disabled: boolean; onChange: (value: TaskChange) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null); const input = useRef<HTMLTextAreaElement>(null); const locked = useRef(false);
  useDialogToasts(open);
  useEffect(() => { if (!open) return; const element = dialog.current; const previous = document.activeElement as HTMLElement | null; element?.showModal(); input.current?.focus(); return () => { element?.close(); previous?.focus(); }; }, [open]);
  if (!["PM", "ADMIN"].includes(role) || ["DONE", "CANCELLED"].includes(task.status)) return null;
  async function submit() {
    if (locked.current || disabled) return;
    const parsed = taskCancelSchema.safeParse({ status: "CANCELLED", cancelReason: reason, expectedRowVersion: task.rowVersion });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    locked.current = true; setBusy(true); setError("");
    try { await onChange(parsed.data); setOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "取消失败，请刷新核对状态"); }
    finally { locked.current = false; setBusy(false); }
  }
  return <div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <details className="relative text-xs"><summary aria-label={`更多操作 ${task.title}`} className="cursor-pointer list-none rounded-md px-2 py-1.5 text-slate-500 hover:bg-slate-100">•••</summary><div className="absolute right-0 z-20 w-32 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"><button type="button" disabled={disabled} onClick={() => { setReason(""); setError(""); setOpen(true); }} className="w-full rounded px-3 py-2 text-left text-red-700 hover:bg-red-50 disabled:opacity-40">取消任务</button></div></details>
    {open && <dialog ref={dialog} aria-labelledby={`cancel-task-title-${task.id}`} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!locked.current) setOpen(false); }} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/50">
      <h2 id={`cancel-task-title-${task.id}`} className="text-lg font-semibold">取消任务</h2><p className="mt-3 break-words rounded-xl bg-red-50 p-4 text-sm leading-7 text-red-800">您将取消【{task.title}】。取消后不可恢复，不能再分配负责人或签署。原计划、交付资料与审计记录保留。</p>
      <form onSubmit={event => { event.preventDefault(); void submit(); }} className="mt-4 space-y-4"><label className="block text-sm font-medium">取消原因<textarea ref={input} autoFocus required minLength={10} maxLength={1000} rows={4} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} placeholder="请填写取消原因及对后续工作的影响（10～1000 字）" className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100" /></label>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2">返回</button><button disabled={disabled || busy || reason.trim().length < 10} className="rounded-lg bg-red-700 px-4 py-2 text-white disabled:opacity-40">{busy ? "正在取消…" : "确认取消任务"}</button></div></form><ToastViewport />
    </dialog>}
  </div>;
}
