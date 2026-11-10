"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, OctagonX, X, History } from "lucide-react";
import { useProjectCapabilities } from "./capabilities-context";
import { useToast } from "@/components/toast-provider";
import { projectStatuses } from "@/modules/projects/status-display";

type Action = "pause" | "resume" | "cancel";
const labels = { pause: "暂停项目", resume: "恢复项目", cancel: "取消项目" };
type Change = { id: string; action: Action; fromStatus: keyof typeof projectStatuses; toStatus: keyof typeof projectStatuses; reason: string; createdAt: string; actor: { name: string } };
export function ProjectLifecycleControls({ projectId }: { projectId: string }) {
  const { capabilities: caps, refresh, freezeAfterTransition } = useProjectCapabilities(); const { notify } = useToast(); const router = useRouter();
  const [action, setAction] = useState<Action | null>(null); const [reason, setReason] = useState(""); const [confirmation, setConfirmation] = useState(""); const [projectName, setProjectName] = useState("");
  const [history, setHistory] = useState<Change[]>([]); const [showHistory, setShowHistory] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const requestKey = useRef<string | null>(null); const inflight = useRef(false); const reasonInput = useRef<HTMLTextAreaElement>(null); const opener = useRef<HTMLElement | null>(null);
  const allowed = useCallback((value: Action) => value === "pause" ? caps?.canPause : value === "resume" ? caps?.canResume : caps?.canCancel, [caps]);
  function close() { if (inflight.current) return; setAction(null); requestAnimationFrame(() => opener.current?.focus()); }
  async function open(value: Action) {
    if (!allowed(value)) return; opener.current = document.activeElement as HTMLElement; setError(""); setReason(""); setConfirmation(""); requestKey.current = null;
    try { const res = await fetch(`/api/projects/${projectId}/lifecycle`, { cache: "no-store" }); const body = await res.json(); if (!res.ok) throw new Error(body.error); setProjectName(body.data.project.name); setAction(value); }
    catch { notify("无法读取项目状态，请刷新后重试", "error"); }
  }
  useEffect(() => { if (action) reasonInput.current?.focus(); }, [action]);
  useEffect(() => {
    if (!showHistory) return; const ac = new AbortController();
    void fetch(`/api/projects/${projectId}/lifecycle`, { cache: "no-store", signal: ac.signal }).then(async res => { const body = await res.json(); if (!res.ok) throw new Error(body.error); if (!ac.signal.aborted) setHistory(body.data.statusHistory ?? []); }).catch(() => { if (!ac.signal.aborted) notify("状态记录加载失败，请重试", "error"); });
    return () => ac.abort();
  }, [projectId, showHistory, caps?.rowVersion, notify]);
  useEffect(() => { if (action && !allowed(action) && !inflight.current) setAction(null); }, [action, allowed, busy]);
  async function submit() {
    if (!action || !caps || !allowed(action) || inflight.current) return;
    inflight.current = true; setBusy(true); setError(""); requestKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/projects/${projectId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim(), expectedRowVersion: caps.rowVersion, requestKey: requestKey.current, ...(action === "cancel" ? { confirmationName: confirmation } : {}) }) });
      const body = await response.json(); if (!response.ok) { if (response.status === 409) { requestKey.current = null; await refresh(); } throw new Error(body.error || "操作失败，请重试"); }
      const label = labels[action]; freezeAfterTransition(body.data.project.status, body.data.change.reason, body.data.project.rowVersion); setAction(null); requestKey.current = null; notify(`${label}已保存并记录审计`);
      try { await refresh(); router.refresh(); } catch { notify("操作已成功，但数据刷新失败，请手动刷新", "error"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "请求中断，请刷新核对项目状态后重试"); }
    finally { inflight.current = false; setBusy(false); }
  }
  if (!caps) return null;
  return <section aria-label="项目状态操作" className="shrink-0 border-b border-slate-200 bg-white/80 px-4 py-2 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">项目生命周期 · {projectStatuses[caps.status as keyof typeof projectStatuses]?.label ?? caps.status}</span><div className="flex flex-wrap gap-2">
      {(["pause", "resume", "cancel"] as const).filter(allowed).map(value => { const Icon = value === "pause" ? Pause : value === "resume" ? Play : OctagonX; return <button key={value} type="button" disabled={busy} onClick={() => void open(value)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${value === "cancel" ? "text-red-700 hover:bg-red-50" : "text-teal-800 hover:bg-teal-50"}`}><Icon className="size-3.5" aria-hidden="true" />{labels[value]}</button>; })}
      <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"><History className="size-3.5" aria-hidden="true" />状态记录</button>
    </div></div>
    {showHistory && <div aria-label="项目状态变更记录" className="mt-3 max-h-60 space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-3">{!history.length && <p className="text-xs text-slate-500">暂无暂停、恢复或取消记录。</p>}{history.map(row => <article key={row.id} className="border-l-2 border-teal-300 pl-3 text-xs"><p className="font-medium text-slate-800">{labels[row.action]} · {projectStatuses[row.fromStatus]?.label} → {projectStatuses[row.toStatus]?.label}</p><p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{row.reason}</p><p className="mt-1 text-slate-400">{row.actor.name} · {new Date(row.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong" })}</p></article>)}</div>}
    {action && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" onKeyDown={event => { if (event.key === "Escape") close(); if (event.key === "Tab") { const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input'); const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}>
      <form role="dialog" aria-modal="true" aria-labelledby="lifecycle-dialog-title" onSubmit={event => { event.preventDefault(); void submit(); }} className="max-h-[90dvh] w-full max-w-lg space-y-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between"><h2 id="lifecycle-dialog-title" className="text-lg font-semibold">{labels[action]}</h2><button type="button" aria-label="关闭状态操作" disabled={busy} onClick={close} className="rounded-md p-1 text-slate-500 disabled:opacity-40"><X className="size-5" /></button></div>
        <div className={`rounded-xl p-4 text-sm leading-6 ${action === "cancel" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}><strong className="block break-words">{projectName}</strong>{action === "pause" ? "暂停后，任务、排期及交付资料将冻结。已有数据保留，恢复时不会自动顺延日期。" : action === "cancel" ? "取消后将永久停止项目执行，所有业务资料只读，不能通过恢复或启动重新启用。历史任务与审计记录保留。" : "恢复后重新开放业务编辑。请检查原有计划日期和人员负荷，系统不会自动改动排期。"}</div>
        <label className="block text-sm font-medium">{action === "pause" ? "暂停说明" : action === "cancel" ? "取消说明" : "恢复说明"}<textarea ref={reasonInput} required disabled={busy} minLength={10} maxLength={1000} rows={4} value={reason} onChange={event => { setReason(event.target.value); requestKey.current = null; }} placeholder="请说明业务原因、影响及后续安排（10～1000 字）" className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm font-normal focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100" /><span className="mt-1 block text-right text-xs font-normal text-slate-400">{reason.trim().length} / 1000</span></label>
        {action === "cancel" && <label className="block text-sm font-medium">输入完整项目名称以确认<input required disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-lg border border-red-200 p-3 font-normal" /></label>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={close} className="rounded-lg border border-slate-200 px-4 py-2 text-sm disabled:opacity-40">返回</button><button type="submit" disabled={busy || reason.trim().length < 10 || !allowed(action) || action === "cancel" && confirmation !== projectName} className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${action === "cancel" ? "bg-red-700" : "bg-teal-800"}`}>{busy ? "正在保存…" : `确认${labels[action]}`}</button></div>
      </form>
    </div>}
  </section>;
}
