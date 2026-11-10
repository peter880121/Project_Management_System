"use client";
import { AcceptanceCheckControls } from "@/components/projects/acceptance-check-controls";
import { useProjectTaskRefresh } from "@/components/projects/task-refresh";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";
import { groupTasksByPhase, taskPhase, UNGROUPED_PHASE } from "@/modules/projects/task-phases";
import Link from "next/link";
import { BackLink } from "@/components/page-back-link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, LayoutGrid } from "lucide-react";
import { ProjectBoardNavigation } from "@/components/projects/project-board-navigation";
import { ElectronicSignatureModal } from "@/components/tasks/electronic-signature-modal";
import { TaskPhaseGroup } from "@/components/tasks/task-phase-group";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer";
import { checkCompletionTask } from "@/components/assets/completion-check";
import { orderBoardTasks, taskColumns, type BoardTask, type TaskChange } from "@/components/tasks/board-types";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/toast-provider";

export function TaskBoard({ project, role, userId, createdTaskId, openTaskId, onboarding = false, openDeliverables = false, returnTo = "/projects" }: { returnTo?: string; project: { id: string; name: string }; role: string; userId: string; createdTaskId?: string; openTaskId?: string; onboarding?: boolean; openDeliverables?: boolean }) {
  const { capabilities } = useProjectCapabilities();
  const { notify } = useToast();
  const [signing, setSigning] = useState<BoardTask | null>(null);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ id: string; mode?: "wbs" | "compliance"; deliverableGuide?: boolean } | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const reveal = useCallback((task: BoardTask, status = task.status) => {
    setExpanded(previous => ({ ...previous, [JSON.stringify([status, taskPhase(task.description) ?? UNGROUPED_PHASE])]: true }));
    setHighlighted(task.id);
  }, []);
  useEffect(() => {
    if (!highlighted || selected) return;
    const frame = requestAnimationFrame(() => document.getElementById(`board-task-${highlighted}`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }));
    const timer = setTimeout(() => setHighlighted(null), 4000);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [highlighted, tasks, selected]);
  const locks = useRef(new Set<string>());
  const completionAbort = useRef<AbortController | null>(null);
  useEffect(() => () => completionAbort.current?.abort(), []);
  async function complete(task: BoardTask) {
    completionAbort.current?.abort(); const current = new AbortController(); completionAbort.current = current;
    try {
      const fresh = await checkCompletionTask(task.id, current.signal); if (current.signal.aborted) return;
      if (fresh.requiresDeliverable && !fresh.deliverables?.length) setSelected({ id: task.id, deliverableGuide: true }); else setSigning(fresh);
    } catch (e) { if (!current.signal.aborted) notify(e instanceof Error ? e.message : "无法核对交付证据", "error"); }
  }
  const version = useRef(0);
  const announced = useRef("");
  const knownTasks = useRef<{ projectId: string; phases: Map<string, string | null> } | null>(null);
  const invalidate = useCallback(() => { version.current += 1; }, []);
  const load = useCallback(async () => {
    const current = ++version.current;
    const response = await fetch(`/api/projects/${project.id}/tasks`, { cache: "no-store" });
    const result = await response.json() as { data?: BoardTask[]; error?: string };
    if (!response.ok) throw new Error(result.error || "任务加载失败，请重试");
    if (current === version.current) {
      const ordered = orderBoardTasks(result.data || []);
      // Include tasks created by confirmed AI suggestions while this board remains mounted.
      if (knownTasks.current?.projectId === project.id && !locks.current.size) {
        for (const task of ordered) if (!knownTasks.current.phases.has(task.id) || knownTasks.current.phases.get(task.id) !== taskPhase(task.description)) reveal(task);
      }
      knownTasks.current = { projectId: project.id, phases: new Map(ordered.map(task => [task.id, taskPhase(task.description)])) };
      setTasks(ordered); setError("");
    }
  }, [project.id, reveal]);
  useProjectTaskRefresh(project.id, load);
  useEffect(() => {
    if (openTaskId && tasks.some(task => task.id === openTaskId) && announced.current !== `open:${openTaskId}`) { announced.current = `open:${openTaskId}`; setSelected({ id: openTaskId, deliverableGuide: openDeliverables }); }
  }, [openTaskId, openDeliverables, tasks]);
  useEffect(() => {
    let active = true;
    void load().catch(() => { if (active) setError("任务列表暂时无法加载，请重试"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; invalidate(); };
  }, [load, invalidate]);
  useEffect(() => {
    if (createdTaskId && tasks.some(task => task.id === createdTaskId) && announced.current !== createdTaskId) { announced.current = createdTaskId; reveal(tasks.find(task => task.id === createdTaskId)!); notify("任务创建成功，已加入看板并记录审计"); }
  }, [createdTaskId, tasks, notify, reveal]);
  async function update(taskId: string, change: TaskChange) {
    if (locks.current.has(taskId)) return;
    locks.current.add(taskId); setPending(new Set(locks.current));
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRowVersion: tasks.find(task => task.id === taskId)?.rowVersion, ...change }) });
      const result = await response.json() as { error?: string; code?: string };
      if (!response.ok) {
        if (response.status === 409) { if (result.code === "TASK_CANCELLED") setSigning(null); try { await load(); } catch {} window.dispatchEvent(new CustomEvent("task-lifecycle-changed", { detail: { taskId } })); }
        throw new Error(result.error || "任务更新失败");
      }
      // Reveal the committed destination even if the subsequent GET fails.
      if ("status" in change) {
        const task = tasks.find(item => item.id === taskId);
        if (task) reveal(task, change.status);
        setTasks(items => items.map(task => task.id === taskId ? { ...task, status: change.status, rowVersion: task.rowVersion === undefined ? undefined : task.rowVersion + 1 } : task));
      }
      notify("status" in change && change.status === "DONE" ? "已签署并保存" : "status" in change && change.status === "CANCELLED" ? "任务已取消，已移入已取消任务分组" : "更新已保存并记录到审计时间线");
      try { await load(); } catch { setError("操作已保存，但看板刷新失败，请重试"); notify("status" in change && change.status === "DONE" ? "签署已成功，但数据刷新失败，请手动刷新" : "操作已保存，但看板刷新失败，请重试", "error"); }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "网络连接失败，请核对任务状态后重试";
      if (!("status" in change && change.status === "DONE")) notify(message, "error"); throw new Error(message);
    } finally { locks.current.delete(taskId); setPending(new Set(locks.current)); }
  }
  return <main aria-label="项目任务工作区" className="flex h-full min-h-0 flex-col overflow-hidden px-4 py-4 sm:px-6">
    {onboarding && <section aria-label="新项目引导" className="mb-3 shrink-0 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900"><strong>第 2 步 / 共 2 步 · 安排并执行任务</strong><p className="mt-1 text-xs leading-6">点击任务配置负责人、计划日期、预计工时和前置依赖；甘特图同步展示计划，完成时单独签署实际结果。</p></section>}
    <header aria-label="任务看板页头" className="shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-72 flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
          <BackLink href={returnTo}>返回项目看板</BackLink>
          <div className="min-w-0 sm:border-l sm:border-slate-200 sm:pl-4"><h1 title={project.name} className="line-clamp-2 break-words text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{project.name}</h1><p className="mt-1 text-xs text-slate-400">任务执行与交付跟踪</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2"><AcceptanceCheckControls projectId={project.id} compact />{["PM", "ADMIN"].includes(role) && <Link href={`/projects/${project.id}/tasks/new`} aria-disabled={capabilities?.canEditTasks === false} tabIndex={capabilities?.canEditTasks === false ? -1 : undefined} onClick={event => { if (capabilities?.canEditTasks === false) event.preventDefault(); }} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border-teal-800 bg-teal-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-900 ${capabilities?.canEditTasks === false ? "pointer-events-none opacity-40" : ""}`}><Plus aria-hidden="true" className="size-4" />创建任务</Link>}</div>
      </div>
      <ProjectBoardNavigation projectId={project.id} role={role} />
    </header>
    {error && <div role="alert" className="mt-2 flex shrink-0 items-center justify-between gap-3 rounded-lg bg-red-50 p-2 text-xs text-red-800"><p>{error}</p><button type="button" onClick={() => { setLoading(true); void load().catch(() => setError("任务列表暂时无法加载，请重试")).finally(() => setLoading(false)); }} className="shrink-0">重试加载</button></div>}
    <div className="mt-3 flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs"><LayoutGrid aria-hidden="true" className="size-3.5 text-teal-700" /><span className="font-semibold text-slate-700">交付任务</span><span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-400">按所属阶段分组</span></div><div className="flex items-center gap-1"><button type="button" disabled={loading} onClick={() => setExpanded(Object.fromEntries(tasks.map(task => [JSON.stringify([task.status, taskPhase(task.description) ?? UNGROUPED_PHASE]), true])))} className="min-h-8 rounded-lg border-0 bg-transparent px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40">全部展开</button><span aria-hidden="true" className="h-3 border-l border-slate-200" /><button type="button" disabled={loading} onClick={() => setExpanded(Object.fromEntries(tasks.map(task => [JSON.stringify([task.status, taskPhase(task.description) ?? UNGROUPED_PHASE]), false])))} className="min-h-8 rounded-lg border-0 bg-transparent px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40">全部折叠</button></div></div>
    <section aria-label="任务看板" aria-busy={loading} className="mt-2 grid min-h-0 flex-1 grid-cols-[repeat(4,minmax(272px,1fr))] gap-3 overflow-x-auto overflow-y-hidden pb-2 2xl:gap-4 lg:grid-cols-4">
      {taskColumns.map(column => <section key={column.status} aria-label={`${column.title}列`} className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-slate-50/80"><h2 className="flex shrink-0 items-center justify-between border-b border-slate-200/70 px-3 py-3 text-sm font-semibold"><span className="flex items-center gap-2"><span aria-hidden="true" className={`size-2 rounded-full ${column.dot}`} />{column.title}</span><span className="min-w-6 rounded-full bg-slate-200/50 px-2 py-0.5 text-center text-xs font-medium text-slate-500">{loading ? "…" : tasks.filter(task => task.status === column.status).length}</span></h2>
        <div aria-label={`${column.title}任务列表`} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-2.5 pb-3 pt-2.5">
          {loading ? <div role="status" aria-label="正在加载看板任务" className="space-y-3"><span className="sr-only">正在加载看板任务</span>{[0, 1, 2].map(index => <div key={index} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-5 w-5/6" /><Skeleton className="h-3 w-full" /><Skeleton className="h-7 w-1/2" /></div>)}</div> : <>{groupTasksByPhase(tasks.filter(task => task.status === column.status)).map((group, index) => { const key = JSON.stringify([column.status, group.phase]); const open = expanded[key] ?? (column.status !== "TODO" || index === 0); return <TaskPhaseGroup key={group.phase} id={`phase-${column.status}-${encodeURIComponent(group.phase)}`} phase={group.phase} count={group.tasks.length} open={open} onToggle={() => setExpanded(previous => ({ ...previous, [key]: !open }))}>{group.tasks.map(task => <div key={task.id} id={`board-task-${task.id}`} className={`rounded-xl transition-shadow ${highlighted === task.id ? "ring-2 ring-teal-500 ring-offset-2" : ""}`}><TaskCard key={task.id} task={task} showPhase={false} role={role} userId={userId} busy={pending.has(task.id)} onOpen={mode => setSelected({ id: task.id, mode })} onComplete={() => void complete(task)} onLifecycle={change => update(task.id, change)} onStatus={status => void update(task.id, { status }).catch(() => {})} /></div>)}</TaskPhaseGroup>; })}{!error && !tasks.some(task => task.status === column.status) && <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 py-9 text-xs text-slate-400"><LayoutGrid aria-hidden="true" className="size-5" />暂无任务</div>}</>}
        </div>
      </section>)}
    </section>
    <details aria-label="已取消任务" className="mt-2 max-h-[35vh] shrink-0 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-500">已取消任务（{tasks.filter(task => task.status === "CANCELLED").length}）</summary><div className="mt-3 grid gap-3 md:grid-cols-3">{tasks.filter(task => task.status === "CANCELLED").map(task => <TaskCard key={task.id} task={task} role={role} userId={userId} busy={false} onOpen={() => setSelected({ id: task.id })} onComplete={() => {}} onStatus={() => {}} />)}</div></details>
    {signing && <ElectronicSignatureModal task={signing} onClose={() => setSigning(null)} onConfirm={value => update(signing.id, value)} />}
    {selected && <TaskDetailDrawer key={selected.id} taskId={selected.id} initialMode={selected.mode} initialDeliverableGuide={selected.deliverableGuide} projectId={project.id} role={role} userId={userId} onClose={() => setSelected(null)} onUpdate={update} onRefresh={load} />}
  </main>;
}
