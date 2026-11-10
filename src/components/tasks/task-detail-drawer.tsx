"use client";

import { AuditEntry } from "@/components/audit/audit-entry";
import { TaskLifecycleMenu, DependencyWarning } from "./task-lifecycle-menu";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";
import { DeliverablesPanel } from "@/components/assets/deliverables-panel";
import { checkCompletionTask } from "@/components/assets/completion-check";
import { ElectronicSignatureModal } from "./electronic-signature-modal";
import { PlanActualSummary } from "./plan-actual-summary";
import { TaskPlanEditor } from "./task-plan-editor";
import { TaskDetailsEditor } from "./task-details-editor";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { TaskAiActions } from "../task-ai-actions";
import { TaskAiContent } from "../task-ai-drawer";
import { ToastViewport, useDialogToasts, useToast } from "../toast-provider";
import { TaskDetailSkeleton } from "../ui/skeleton";
import { canUpdateTask, taskColumns, taskPhase, taskStatusOptions, type TaskChange, type TaskDetail, type UserOption } from "./board-types";
import { statusLabels } from "./task-card";
import { canRefineTask, canCheckTaskEvidence } from "@/modules/ai/task-actions";

export function TaskDetailDrawer({ taskId, initialMode, initialDeliverableGuide = false, projectId, role: initialRole, userId, onClose, onUpdate, onRefresh }: { taskId: string; initialDeliverableGuide?: boolean; initialMode?: "wbs" | "compliance"; projectId: string; role: string; userId: string; onClose: () => void; onUpdate: (taskId: string, change: TaskChange) => Promise<void>; onRefresh: () => Promise<void> }) {
  const { capabilities } = useProjectCapabilities(); const role = capabilities?.role ?? initialRole;
  const { notify } = useToast();
  useDialogToasts();
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [usersError, setUsersError] = useState("");
  const [usersLoading, setUsersLoading] = useState(role === "PM");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [signing, setSigning] = useState(false);
  const [assetTab, setAssetTab] = useState(initialDeliverableGuide);
  const [guide, setGuide] = useState(initialDeliverableGuide);
  const [mode, setMode] = useState<"details" | "wbs" | "compliance">(initialMode ?? "details");
  const [membersAttempt, setMembersAttempt] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.close(); controller.current?.abort(); document.body.style.overflow = previous; queueMicrotask(() => document.querySelector<HTMLElement>(`[data-task-card="${taskId}"]`)?.focus()); };
  }, [taskId]);
  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setRefreshing(true); setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { cache: "no-store", signal: current.signal });
      const result = await response.json() as { data?: TaskDetail; error?: string };
      if (current.signal.aborted) return;
      if (!response.ok || !result.data || result.data.id !== taskId) throw new Error(result.error || "无法加载任务详情");
      setTask(result.data);
      if (result.data.deliverables?.length) setGuide(false);
    } catch (cause) {
      if (!current.signal.aborted) { const message = cause instanceof Error ? cause.message : "无法加载任务详情"; setError(message); throw new Error(message); }
    } finally { if (!current.signal.aborted) setRefreshing(false); }
  }, [taskId]);
  useEffect(() => { const changed = (event: Event) => { if (event instanceof CustomEvent && event.detail?.taskId === taskId) void load().catch(() => {}); }; window.addEventListener("task-lifecycle-changed", changed); return () => window.removeEventListener("task-lifecycle-changed", changed); }, [load, taskId]);
  useEffect(() => { void load().catch(() => {}); return () => controller.current?.abort(); }, [load]);
  useEffect(() => {
    if (role !== "PM") return;
    const current = new AbortController(); setUsersLoading(true); setUsersError("");
    void fetch(`/api/users/options?projectId=${projectId}`, { signal: current.signal }).then(async response => {
      const result = await response.json() as { data?: UserOption[]; error?: string };
      if (!response.ok) throw new Error(result.error || "成员列表加载失败");
      if (!current.signal.aborted) setUsers(result.data || []);
    }).catch(() => { if (!current.signal.aborted) setUsersError("成员列表加载失败，请重试"); }).finally(() => { if (!current.signal.aborted) setUsersLoading(false); });
    return () => current.abort();
  }, [role, projectId, membersAttempt]);
  useEffect(() => { if (task?.status === "CANCELLED") { setMode("details"); setSigning(false); } }, [task?.status]);
  async function change(value: TaskChange) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try { await onUpdate(taskId, { expectedRowVersion: task?.rowVersion, ...value }); try { await load(); } catch { notify("操作已保存，但任务详情刷新失败，请重试加载", "error"); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "更新失败，请重试"); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function requestCompletion() {
    if (submitting.current) return; submitting.current = true; setBusy(true); setError("");
    const current = new AbortController(); controller.current?.abort(); controller.current = current;
    try {
      const fresh = await checkCompletionTask(taskId, current.signal); if (current.signal.aborted) return; setTask(fresh);
      if (fresh.requiresDeliverable && !fresh.deliverables?.length) { setGuide(true); setAssetTab(true); return; }
      setGuide(false); setSigning(true);
    } catch (e) { if (!current.signal.aborted) setError(e instanceof Error ? e.message : "无法核对交付证据"); }
    finally { submitting.current = false; if (!current.signal.aborted) setBusy(false); }
  }
  async function accepted() {
    const results = await Promise.allSettled([onRefresh(), load()]);
    if (results.some(result => result.status === "rejected")) { notify("AI 采纳已保存，但列表或详情刷新失败", "error"); throw new Error("Refresh failed"); }
    notify("AI 建议已采纳，任务与审计已更新");
  }
  return <dialog ref={dialog} aria-labelledby="task-detail-title" onCancel={event => { event.preventDefault(); onClose(); }} className="task-detail-drawer fixed inset-0 m-0 ml-auto flex h-dvh max-h-none w-full max-w-none flex-col border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/45 sm:max-w-[500px]">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><p className="text-xs text-teal-700">项目交付任务</p><h2 id="task-detail-title" className="mt-1 font-semibold">{mode === "details" ? "任务详情" : mode === "wbs" ? "细化子任务" : "检查合规证据"}</h2></div><button autoFocus aria-label="关闭任务详情" type="button" onClick={onClose} className="rounded-lg border-slate-200 p-2"><X aria-hidden="true" className="size-4" /></button></header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-busy={busy || refreshing}>
      {error && <div role="alert" className="m-5 rounded-lg bg-red-50 p-3 text-sm text-red-800"><p>{error}</p><button type="button" onClick={() => void load().catch(() => {})} className="mt-2">重新加载详情</button></div>}
      {!task ? (!error && <TaskDetailSkeleton />) : <div className="space-y-5 p-5">
        <div><div className="mb-2 flex flex-wrap gap-2">{taskPhase(task.description) && <span className="rounded bg-teal-50 px-2 py-1 text-xs text-teal-800">{taskPhase(task.description)}</span>}<span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{task.status === "CANCELLED" ? "已取消" : taskColumns.find(column => column.status === task.status)?.title}</span></div><h3 className="break-words text-xl font-semibold">{task.title}</h3></div>
        <DependencyWarning task={task} />
        {task.status === "CANCELLED" && <p role="status" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><strong>已取消 · 只读</strong><br />{task.cancelReason}</p>}
        {mode === "details" && <TaskLifecycleMenu task={task} role={role} disabled={busy || refreshing || capabilities?.canEditTasks === false} onChange={async value => { await onUpdate(taskId, value); if ("status" in value && value.status === "CANCELLED") setTask(current => current ? { ...current, status: "CANCELLED", cancelReason: value.cancelReason } : current); try { await load(); } catch { notify("任务已取消，但详情刷新失败，请手动刷新", "error"); } }} />}
        {mode === "details" && <div role="tablist" aria-label="任务工作区" className="flex gap-2 border-b border-slate-200 pb-2"><button type="button" role="tab" aria-selected={!assetTab} onClick={() => setAssetTab(false)} className="rounded-lg px-3 py-2 text-sm text-teal-800">任务信息</button><button type="button" role="tab" aria-selected={assetTab} onClick={() => setAssetTab(true)} className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">📎 交付物管理</button></div>}
        {mode === "details" && guide && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-7 text-amber-900">该任务必须挂载交付物。请前往下方【交付物管理】上传并通过审批后再完成。<button type="button" onClick={() => setAssetTab(true)} className="mt-2 block font-semibold underline">前往交付物管理</button></div>}
        {mode === "details" && assetTab ? <DeliverablesPanel projectId={projectId} taskId={taskId} readOnly={task.status === "CANCELLED"} role={role} userId={userId} onChanged={async () => { await Promise.all([load(), onRefresh()]); }} /> : mode !== "details" ? <><button type="button" onClick={() => setMode("details")} className="inline-flex items-center gap-2 border-0 p-0 text-sm text-teal-800"><ArrowLeft aria-hidden="true" className="size-4" />返回任务信息</button><TaskAiContent key={`${task.id}:${mode}`} selection={{ task, mode }} projectId={projectId} role={role} onAccepted={accepted} onFeedback={notify} /></> : <>
          {["PM", "ADMIN"].includes(role) && <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={!!task.requiresDeliverable} disabled={task.status === "CANCELLED" || capabilities?.canEditTasks === false || busy || refreshing || task.status === "DONE" || !task.updatedAt} onChange={event => void change({ requiresDeliverable: event.target.checked, expectedUpdatedAt: task.updatedAt! })} />📎 完成前必须有审批通过的交付物</label>}
          <section><h4 className="text-sm font-semibold">任务说明</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{task.description || "暂无任务说明"}</p></section>
          <section className="space-y-3 rounded-xl bg-slate-50 p-4"><h4 className="text-sm font-semibold">负责人和状态</h4>{role === "PM" ? <><label className="block text-xs text-slate-600">分配负责人<select aria-label={`分配 ${task.title}`} disabled={task.status === "CANCELLED" || capabilities?.canEditTasks === false || busy || refreshing || usersLoading || !!usersError} value={task.assigneeId || ""} onChange={event => void change({ assigneeId: event.target.value || null })} className="mt-2 block w-full rounded-md bg-white p-2 text-sm"><option value="">未分配</option>{task.assigneeId && !users.some(user => user.id === task.assigneeId) && <option value={task.assigneeId}>{task.assignee?.name || "当前负责人"}</option>}{users.map(user => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label>{usersLoading && <p className="text-xs text-slate-500">正在加载可分配成员…</p>}{usersError && <p role="alert" className="text-sm text-red-800">{usersError}<button type="button" className="ml-2" onClick={() => setMembersAttempt(value => value + 1)}>重试成员列表</button></p>}</> : <p className="text-sm">负责人：{task.assignee?.name || "未分配"}</p>}
            {canUpdateTask(task, role, userId) && <><div className="flex flex-wrap gap-2">{taskStatusOptions(task.status, role).map(status => <button key={status} type="button" disabled={task.status === "CANCELLED" || capabilities?.canEditTasks === false || busy || refreshing || ["IN_PROGRESS", "DONE"].includes(status) && task.dependencies?.some(edge => edge.dependsOn.status === "CANCELLED")} onClick={() => { if (status === "DONE") void requestCompletion(); else if (status !== "CANCELLED" && (task.status !== "DONE" || window.confirm("重开将清空实际完成日期、实际工时和当前签名关联；历史审计保留。确认重开？"))) void change({ status }); }} className="rounded-md border-teal-200 bg-white px-3 py-2 text-xs text-teal-800 disabled:opacity-40">{task.status === "DONE" && status === "IN_PROGRESS" ? "重新打开" : statusLabels[status]}</button>)}</div></>}

          </section>
          <PlanActualSummary task={task} />
          <TaskDetailsEditor key={`${task.id}:${task.rowVersion}`} task={task} projectId={projectId} onReload={async () => { const results = await Promise.allSettled([load(), onRefresh()]); if (results.some(result => result.status === "rejected")) throw new Error("数据刷新失败，请重试"); }} />
          {role === "PM" && <TaskPlanEditor key={`${task.id}:${task.scheduleVersion}`} task={task} projectId={projectId} onReload={async () => { const results = await Promise.allSettled([load(), onRefresh()]); if (results.some(result => result.status === "rejected")) throw new Error("数据刷新失败，请重试"); }} />}
          {((role === "PM" && canRefineTask(task.title)) || (["PM", "ADMIN", "QA"].includes(role) && canCheckTaskEvidence(task.title))) && <section><h4 className="mb-3 text-sm font-semibold">AI 任务助手</h4><TaskAiActions disabled={task.status === "CANCELLED"} task={task} role={role} onSelect={selection => setMode(selection.mode)} /></section>}
          <section><h4 className="text-sm font-semibold">前置任务</h4>{task.dependencies?.length ? <ul className="mt-2 space-y-2 text-sm text-slate-600">{task.dependencies.map(({ dependsOn }) => <li key={dependsOn.id} className="flex items-start justify-between gap-3"><span>{dependsOn.title}</span><span className="shrink-0 text-xs">{taskColumns.find(column => column.status === dependsOn.status)?.title ?? (dependsOn.status === "CANCELLED" ? "已取消" : dependsOn.status)}</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">无前置任务</p>}</section>
          <section><h4 className="text-sm font-semibold">需求与测试追溯</h4><p className="mt-2 text-sm text-slate-600">{task.requirement?.title || "尚未关联需求"}</p>{task.requirement && <ul className="mt-2 space-y-2 text-xs text-slate-500">{task.requirement.testCases.map(test => <li key={test.id}>{test.title} · {test.status}</li>)}{!task.requirement.testCases.length && <li>尚无测试用例</li>}</ul>}</section>
          <section><h4 className="text-sm font-semibold">最近审计记录</h4><ul className="mt-2 space-y-2 text-xs text-slate-500">{task.audits.slice(-5).reverse().map(entry => <li key={entry.id}><AuditEntry row={entry} compact /></li>)}{!task.audits.length && <li>暂无审计记录</li>}</ul></section>
          <Link href={`/tasks/${task.id}`} className="inline-flex items-center gap-2 border-0 p-0 text-sm text-teal-800">打开完整任务详情<ExternalLink aria-hidden="true" className="size-4" /></Link>
        </>}
      </div>}
    </div>{signing && task && <ElectronicSignatureModal task={task} onClose={() => setSigning(false)} onConfirm={async value => {
      await onUpdate(taskId, value);
      setTask(current => current ? { ...current, status: "DONE", actualHours: String(value.actualHours), completedAt: `${value.completedAt}T00:00:00.000Z` } : current);
      try { await load(); } catch { notify("签署已成功，但数据刷新失败，请手动刷新", "error"); }
    }} />}<ToastViewport />
  </dialog>;
}
