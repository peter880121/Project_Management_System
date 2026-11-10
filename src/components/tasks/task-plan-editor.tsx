"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";
import { announceTaskCreated as announceTasksChanged } from "@/components/projects/task-refresh";
import { useToast } from "@/components/toast-provider";
import { scheduleFormInput, scheduleValidationMessage } from "@/modules/planning/form-input";
import { dateLabel } from "@/modules/tasks/plan";
import type { TaskDetail } from "./board-types";

export function TaskPlanEditor({ task, projectId, onReload }: { task: TaskDetail; projectId: string; onReload: () => Promise<void> }) {
  const { capabilities } = useProjectCapabilities(); const { notify } = useToast();
  const [options, setOptions] = useState<{ id: string; title: string; status: string }[]>([]);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [blocked, setBlocked] = useState(false); const [error, setError] = useState(""); const [attempt, setAttempt] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setReady(false);
    void fetch(`/api/projects/${projectId}/tasks`, { cache: "no-store", signal: controller.signal }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "前置任务加载失败"); if (!controller.signal.aborted) { setOptions(result.data); setReady(true); setError(""); } }).catch(() => { if (!controller.signal.aborted) setError("前置任务加载失败，请重试"); });
    return () => controller.abort();
  }, [projectId, attempt]);
  if (!capabilities?.canSchedule || ["DONE", "CANCELLED"].includes(task.status)) return <p className="text-xs text-slate-500">{task.status === "DONE" ? "已完成任务的计划只读，明确重新打开后可调整。" : "当前计划为只读。"}</p>;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving.current || !ready || task.scheduleVersion === undefined) return;
    const input = scheduleFormInput(new FormData(event.currentTarget), task.scheduleVersion);
    const invalid = scheduleValidationMessage(input); if (invalid) { setError(invalid); return; }
    saving.current = true; setBusy(true); setError(""); let persisted = false;
    try {
      const response = await fetch(`/api/tasks/${task.id}/schedule`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) { setBlocked(true); notify("计划版本已更新，已重新读取，请核对后再保存", "error"); await onReload(); return; }
        throw new Error(result.error || "计划保存失败");
      }
      persisted = true; setBlocked(true); announceTasksChanged(projectId); notify("任务计划已保存并记录审计"); await onReload();
    } catch (cause) { const message = persisted ? "计划已保存，但数据刷新失败，请刷新任务详情" : cause instanceof Error ? cause.message : "计划保存失败"; setError(message); notify(message, "error"); }
    finally { saving.current = false; setBusy(false); }
  }
  return <details className="rounded-xl border border-teal-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-teal-900">编辑计划安排</summary>
    <form aria-label="任务计划安排" onSubmit={e => void save(e)} className="mt-4 space-y-4">
      <p className="text-xs leading-6 text-slate-500">计划变更在任务管理统一保存，甘特图只展示结果。缺少日期或工时的任务保留“待排期”标记。</p>
      <fieldset disabled={busy || !ready || blocked || task.scheduleVersion === undefined} className="space-y-4">
        <label className="block text-sm">预计开始日期<input name="start" aria-label="计划开始日期" type="date" min="2000-01-01" max="2100-12-31" defaultValue={task.plannedStartDate ? dateLabel(task.plannedStartDate) : ""} className="mt-2 block w-full rounded-lg border border-slate-300 p-2" /></label>
        <label className="block text-sm">预计完成日期<input name="due" aria-label="计划完成日期" type="date" min="2000-01-01" max="2100-12-31" defaultValue={task.dueDate ? dateLabel(task.dueDate) : ""} className="mt-2 block w-full rounded-lg border border-slate-300 p-2" /></label>
        <label className="block text-sm">预计工时（小时）<input name="hours" aria-label="计划预计工时" type="number" min="0.01" max="10000" step="0.01" defaultValue={task.estimateHours ?? ""} className="mt-2 block w-full rounded-lg border border-slate-300 p-2" /></label>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">前置任务</legend><div className="max-h-48 space-y-2 overflow-y-auto">{options.filter(row => row.id !== task.id && (row.status !== "CANCELLED" || task.dependencies?.some(edge => edge.dependsOn.id === row.id))).map(row => <label key={row.id} className="flex items-start gap-2 text-xs leading-6"><input type="checkbox" name="dependency" value={row.id} defaultChecked={task.dependencies?.some(edge => edge.dependsOn.id === row.id)} className="mt-1" />{row.title} · {row.status}</label>)}{options.length < 2 && <p className="text-xs text-slate-500">暂无其他可选前置任务</p>}</div></fieldset>
        <button className="rounded-lg bg-teal-800 px-4 py-2 text-sm text-white">{busy ? "保存中…" : "保存任务计划"}</button>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {!ready && <button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)} className="text-xs text-teal-800 underline">重新加载前置任务</button>}
      {blocked && <button type="button" disabled={busy} onClick={() => void onReload().then(() => setBlocked(false)).catch(() => setError("详情刷新失败，请重试"))} className="text-xs text-teal-800 underline">刷新任务计划</button>}
    </form>
  </details>;
}
