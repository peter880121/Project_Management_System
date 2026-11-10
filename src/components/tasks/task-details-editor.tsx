"use client";
import { useRef, useState, type FormEvent } from "react";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";
import { announceTaskCreated } from "@/components/projects/task-refresh";
import { useToast } from "@/components/toast-provider";
import { taskDetailsSchema } from "@/modules/tasks/details-schema";
import { PROJECT_PHASES } from "@/modules/projects/task-phases";
import { taskPhase, type TaskDetail } from "./board-types";
export function TaskDetailsEditor({ task, projectId, onReload }: { task: TaskDetail; projectId: string; onReload: () => Promise<void> }) {
  const { capabilities } = useProjectCapabilities(); const { notify } = useToast(); const saving = useRef(false);
  const [busy, setBusy] = useState(false); const [blocked, setBlocked] = useState(false); const [error, setError] = useState("");
  if (!capabilities?.writable || !["PM", "ADMIN"].includes(capabilities.role) || ["DONE", "CANCELLED"].includes(task.status)) return null;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving.current || blocked) return;
    const form = new FormData(event.currentTarget); const parsed = taskDetailsSchema.safeParse({ operation: "details", expectedRowVersion: task.rowVersion, title: form.get("title"), description: form.get("description"), phase: form.get("phase") });
    if (!parsed.success) { setError("请填写有效的标题、说明和所属阶段"); return; }
    saving.current = true; setBusy(true); setError(""); let persisted = false;
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) }); const result = await response.json();
      if (!response.ok) { if ([403, 409].includes(response.status)) { setBlocked(true); await onReload(); } throw new Error(result.error || "任务信息保存失败"); }
      persisted = true; setBlocked(true); announceTaskCreated(projectId); await onReload(); notify("任务信息已保存，阶段分组已更新");
    } catch (cause) { const message = persisted ? "任务信息已保存，但数据刷新失败，请手动刷新" : cause instanceof Error ? cause.message : "任务信息保存失败"; setError(message); notify(message, "error"); }
    finally { saving.current = false; setBusy(false); }
  }
  return <details className="rounded-xl border border-teal-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-teal-900">编辑任务基本信息</summary><form aria-label="任务基本信息" onSubmit={event => void save(event)} className="mt-4"><fieldset disabled={busy || blocked || task.rowVersion === undefined} className="space-y-4"><label className="block text-sm">任务标题<input name="title" required maxLength={191} defaultValue={task.title} className="mt-2 block w-full rounded-lg border p-2" /></label><label className="block text-sm">所属阶段<input name="phase" required maxLength={50} defaultValue={taskPhase(task.description) ?? ""} list={`task-phase-${task.id}`} className="mt-2 block w-full rounded-lg border p-2" /><datalist id={`task-phase-${task.id}`}>{PROJECT_PHASES.map(phase => <option key={phase} value={phase} />)}</datalist></label><label className="block text-sm">任务说明<textarea name="description" rows={5} maxLength={9900} defaultValue={(task.description ?? "").split(/\r?\n/).filter(line => !/^[\t ]*所属阶段[\t ]*[:：]/.test(line)).join("\n").trim()} className="mt-2 block w-full rounded-lg border p-2" /></label><button className="rounded-lg bg-teal-800 px-4 py-2 text-sm text-white">{busy ? "保存中…" : "保存任务基本信息"}</button></fieldset>{error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}{blocked && <button type="button" className="mt-3 text-sm text-teal-800 underline" onClick={() => void onReload().then(() => setBlocked(false)).catch(() => setError("刷新失败，请手动刷新"))}>重新读取任务信息</button>}</form></details>;
}
