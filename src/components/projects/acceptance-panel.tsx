"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectCapabilities } from "./capabilities-context";
import { useToast } from "@/components/toast-provider";
import { projectStatuses } from "@/modules/projects/status-display";
type Batch = { id: string; round: number; state: string; snapshotSha256: string; submittedAt: string; qaApprovedAt: string | null; reviewComment: string | null };
type Lifecycle = { project: { id: string; name: string; status: keyof typeof projectStatuses; rowVersion: number; currentAcceptanceId: string | null; currentAcceptance: Batch | null }; history: Batch[] };
export function AcceptancePanel({ projectId }: { projectId: string }) {
  const { capabilities: caps, refresh } = useProjectCapabilities(); const { notify } = useToast(); const [data, setData] = useState<Lifecycle | null>(null); const [comment, setComment] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [report, setReport] = useState(""); const key = useRef<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => { const res = await fetch(`/api/projects/${projectId}/lifecycle`, { cache: "no-store", signal }); const body = await res.json(); if (!res.ok) throw new Error(body.error); if (!signal?.aborted) setData(body.data); }, [projectId]);
  useEffect(() => { const ac = new AbortController(); void load(ac.signal).catch(() => { if (!ac.signal.aborted) setError("验收进度加载失败"); }); return () => ac.abort(); }, [load]);
  async function transition(action: string) {
    if (!data || busy) return; setBusy(true); setError(""); key.current ??= crypto.randomUUID();
    try {
      const res = await fetch(`/api/projects/${projectId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRowVersion: data.project.rowVersion, requestKey: key.current, ...(data.project.currentAcceptanceId ? { acceptanceId: data.project.currentAcceptanceId } : {}), comment }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error); key.current = null;
      notify(action === "archive" ? "项目已归档，成员通知已发送，业务资料已冻结" : "状态流转已保存并记录审计"); await load(); await refresh();
    } catch (e) { const message = e instanceof Error ? e.message : "状态流转失败"; setError(message); notify(message, "error"); }
    finally { setBusy(false); }
  }
  async function previewJson() {
    try { const res = await fetch(`/api/projects/${projectId}/report?format=json&preview=1`); if (!res.ok) throw new Error((await res.json()).error); setReport(JSON.stringify(await res.json(), null, 2)); } catch (e) { notify(e instanceof Error ? e.message : "报告读取失败", "error"); }
  }
  if (!data || !caps) return <p role="status">正在加载项目验收…</p>;
  const current = data.project.currentAcceptance;
  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-medium text-teal-700">项目管理闭环</p><h1 className="mt-2 text-2xl font-semibold">{data.project.name} · 验收与归档</h1></div><span className={`rounded-full border px-3 py-1 text-sm ${projectStatuses[data.project.status].color}`}>{projectStatuses[data.project.status].label}</span></div>
      <ol aria-label="结项审批进度" className="mt-6 grid gap-3 sm:grid-cols-3">{["PM 提交验收", "QA 合规审查", "ADMIN 归档冻结"].map((label, i) => <li key={label} className={`rounded-xl border p-4 text-sm ${current && (i === 0 || i === 1 && current.qaApprovedAt || data.project.status === "ARCHIVED") ? "border-teal-200 bg-teal-50 text-teal-900" : "border-slate-200 bg-slate-50 text-slate-500"}`}><span className="mr-2 font-semibold">{i + 1}.</span>{label}</li>)}</ol>
      <p className="mt-4 text-xs leading-6 text-slate-500">提交前要求所有任务完成，必需交付物已经批准。QA 和 ADMIN 均重新计算核心证据哈希，归档后不可重新打开。</p>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {current && <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-5 text-sm"><h2 className="font-semibold">当前验收快照 · 第 {current.round} 轮</h2><p>提交时间：{new Date(current.submittedAt).toLocaleString()}</p><p>QA 审查：{current.qaApprovedAt ? new Date(current.qaApprovedAt).toLocaleString() : "待审查"}</p><p className="break-all font-mono text-xs">SHA-256：{current.snapshotSha256}</p>{current.reviewComment && <p>审查意见：{current.reviewComment}</p>}</div>}
    {caps.status !== "ARCHIVED" && <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"><label className="block text-sm">审查意见 / 撤回或驳回原因<textarea value={comment} maxLength={2000} onChange={e => setComment(e.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-slate-300 p-3" /></label><div className="flex flex-wrap gap-3">{[
      { action: "activate", label: "启动 / 恢复项目", enabled: caps.canActivate }, { action: "submit-acceptance", label: "提交验收", enabled: caps.canSubmitAcceptance }, { action: "qa-approve", label: "QA 审查通过", enabled: caps.canQaApprove }, { action: "archive", label: "最终归档", enabled: caps.canArchive }, { action: "reject-acceptance", label: "驳回验收", enabled: caps.canReject && !!comment.trim() }, { action: "withdraw-acceptance", label: "撤回整改", enabled: caps.canWithdraw && !!comment.trim() },
    ].map(button => <button key={button.action} type="button" disabled={busy || !button.enabled} onClick={() => void transition(button.action)} className="rounded-lg bg-teal-800 px-4 py-2 text-sm text-white disabled:bg-slate-100 disabled:text-slate-400">{button.label}</button>)}</div></div>}
    {caps.status === "ARCHIVED" && ["PM", "QA", "ADMIN"].includes(caps.role) && <section aria-label="结项报告导出" className="space-y-4 rounded-xl border border-teal-200 bg-teal-50/50 p-5"><h2 className="font-semibold">只读结项报告</h2><p className="text-sm text-slate-600">报告引用固定验收快照；每次预览或下载均记录导出审计。</p><div className="flex flex-wrap gap-3"><a href={`/api/projects/${projectId}/report?format=json`} className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm text-teal-800">下载 JSON 报告</a><a href={`/api/projects/${projectId}/report?format=html`} className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm text-teal-800">下载 HTML 报告</a><a target="_blank" rel="noreferrer" href={`/api/projects/${projectId}/report?format=html&preview=1`} className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm text-teal-800">查看 HTML 报告</a><button onClick={() => void previewJson()} className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm text-teal-800">预览 JSON 报告</button></div>{report && <pre aria-label="JSON 结项报告" className="max-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-4 text-xs leading-6">{report}</pre>}</section>}
    <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">验收轮次历史</h2>{data.history.map(row => <p key={row.id} className="mt-3 text-sm text-slate-600">第 {row.round} 轮 · {row.state} · {row.reviewComment || "无补充意见"}</p>)}{!data.history.length && <p className="mt-3 text-sm text-slate-500">尚未提交验收。</p>}</section>
    <Link href={`/projects/${projectId}/board`} className="inline-block text-sm text-teal-800 underline">返回项目看板</Link>
  </section>;
}
