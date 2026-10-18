"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/toast-provider";
export const indexLabels: Record<string, string> = { NOT_SYNCED: "未同步", SYNCING: "同步中", SYNCED: "已入库", FAILED: "同步失败" };
type Row = { id: string; name: string; taskId: string | null; seriesId: string; version: number; rowVersion: number; status: string; createdById: string; submittedById: string | null; reviewedById: string | null; reviewedAt: string | null; reviewComment: string | null; reviewedBy: { name: string } | null; document: { sha256: string; filename: string; fileSize: number }; downloadUrl: string; indexStatus: string };
const labels: Record<string, string> = { DRAFT: "草稿", PENDING_REVIEW: "待审批", APPROVED: "已批准", REJECTED: "已拒绝" };
async function jsonRequest(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const json = await res.json(); if (!res.ok) throw new Error(json.error || "操作失败"); return json;
}
export function DeliverablesPanel({ projectId, taskId, role, userId, onChanged }: { projectId: string; taskId?: string; role: string; userId: string; onChanged?: () => Promise<void> }) {
  const { notify } = useToast(); const [rows, setRows] = useState<Row[]>([]); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(""); const [versionOf, setVersionOf] = useState<Row | null>(null); const [name, setName] = useState(""); const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState(""); const uploadKey = useRef<string | null>(null); const [confirmed, setConfirmed] = useState(false); const [comments, setComments] = useState<Record<string, string>>({}); const [consents, setConsents] = useState<Record<string, boolean>>({}); const [page, setPage] = useState(1);
  const load = useCallback(async (signal?: AbortSignal) => { const res = await fetch(`/api/projects/${projectId}/deliverables?page=${page}${taskId ? `&taskId=${taskId}` : ""}`, { cache: "no-store", signal }); const data = await res.json(); if (!res.ok) throw new Error(data.error); if (!signal?.aborted) setRows(data.data); }, [projectId, taskId, page]);
  useEffect(() => { const ac = new AbortController(); void load(ac.signal).catch(() => { if (!ac.signal.aborted) setError("交付物列表加载失败，请重试"); }); return () => ac.abort(); }, [load]);
  async function refreshSaved(message: string) { notify(message); try { await Promise.all([load(), onChanged?.()]); } catch { setError("操作已保存，但列表刷新失败，请手动刷新"); notify("操作已保存，但数据刷新失败，请手动刷新", "error"); } }
  async function upload(e: FormEvent) {
    e.preventDefault(); if (lock.current || !file || !confirmed) return; lock.current = true; setBusy(true); setError("");
    try {
      let docId = documentId;
      if (!docId) { const form = new FormData(); form.set("file", file); form.set("syntheticOnly", "true"); uploadKey.current ??= crypto.randomUUID(); form.set("uploadKey", uploadKey.current); const res = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body: form }); const body = await res.json(); if (!res.ok) throw new Error(body.error); docId = body.data.id; setDocumentId(docId); }
      await jsonRequest(versionOf ? `/api/deliverables/${versionOf.id}/versions` : `/api/projects/${projectId}/deliverables`, { name, documentId: docId, ...((taskId || versionOf?.taskId) ? { taskId: taskId || versionOf?.taskId } : {}) });
      setDocumentId(""); uploadKey.current = null; setFile(null); setName(""); setVersionOf(null); setConfirmed(false); await refreshSaved("交付版本已保存为草稿");
    } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); } finally { lock.current = false; setBusy(false); }
  }
  async function action(row: Row, operation: string, decision?: string) {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { await jsonRequest(`/api/deliverables/${row.id}/${operation}`, operation === "index" ? { cloudProcessingConfirmed: true } : operation === "submit" ? { rowVersion: row.rowVersion, cloudProcessingConfirmed: true } : { rowVersion: row.rowVersion, decision, reviewComment: comments[row.id] || "" }); await refreshSaved(operation === "review" ? "审批决定已保存并记录审计" : operation === "index" ? "同步已排队" : "已提交审批；批准后将自动建立 AI 索引"); }
    catch (e) { const message = e instanceof Error ? e.message : "操作失败"; setError(message); notify(message, "error"); } finally { lock.current = false; setBusy(false); }
  }
  return <section aria-label="交付物管理" className="space-y-4">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">交付物管理</h3><p className="mt-1 text-xs leading-6 text-slate-500">每个版本独立留存。PM 提交，QA / ADMIN 审批，批准后自动进入 AI 索引流水线。</p></div><button type="button" disabled={busy} onClick={() => void Promise.all([load(), onChanged?.()]).catch(() => setError("刷新失败"))} className="shrink-0 text-xs text-teal-800">刷新状态</button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {role === "PM" && <form onSubmit={upload} className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
      <h4 className="text-sm font-semibold">{versionOf ? `创建 V${Math.max(...rows.filter(r => r.seriesId === versionOf.seriesId).map(r => r.version), versionOf.version) + 1} 新版本` : "上传交付物"}</h4>
      {versionOf && <div className="rounded-lg bg-white p-3 text-xs leading-6"><p>基准版本：V{versionOf.version} · {versionOf.document.filename} · {labels[rows.find(row => row.id === versionOf.id)?.status ?? versionOf.status]}</p><p className="break-all">原文件 SHA-256：{versionOf.document.sha256}</p><p>新文件：{file?.name || "待选择"}。原版本的文件和审批证据将保留。</p><button type="button" onClick={() => { setVersionOf(null); setDocumentId(""); uploadKey.current = null; }} className="text-teal-800 underline">取消新版本</button></div>}
      <label className="block text-sm">交付物名称<input required maxLength={191} value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2" /></label>
      <label className="block text-sm">交付文件（PDF，最大 20 MB）<input key={documentId ? "bound" : "file"} type="file" accept="application/pdf,.pdf" onChange={e => { setFile(e.target.files?.[0] || null); setDocumentId(""); uploadKey.current = null; }} className="mt-2 block w-full text-xs" /></label>
      {documentId && <p className="text-xs text-teal-800">文件已上传。绑定失败时可直接重试保存，无需重新上传。</p>}
      <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我确认文件仅包含合成数据，不含真实患者信息。</label>
      <button disabled={busy || !file || !confirmed} className="rounded-lg bg-teal-800 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "保存中…" : "保存交付版本"}</button>
    </form>}
    {!rows.length && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">暂无交付物。上传并通过审批后，可作为任务完成证据。</p>}
    {rows.map(row => <article key={row.id} data-deliverable={row.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-teal-700">交付版本 V{row.version}</p><h4 className="mt-1 font-semibold">{row.name}</h4></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${row.status === "APPROVED" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{labels[row.status]}</span></div>
      <div className="rounded-lg bg-slate-50 p-3 text-xs leading-6"><a href={row.downloadUrl} className="text-teal-800 underline">下载 V{row.version} · {row.document.filename}</a><p className="break-all font-mono">SHA-256：{row.document.sha256}</p>{row.status === "APPROVED" && <p className="text-emerald-800">已批准版本只读 · {row.reviewedBy?.name} · {row.reviewedAt && new Date(row.reviewedAt).toLocaleString()}</p>}{row.reviewComment && <p>审批意见：{row.reviewComment}</p>}</div>
      <div className="flex flex-wrap items-center gap-3 text-xs"><span className="rounded-md bg-indigo-50 px-2 py-1 text-indigo-800">AI 索引：{indexLabels[row.indexStatus]}</span>{row.status === "APPROVED" && row.indexStatus === "FAILED" && ["PM", "QA", "ADMIN"].includes(role) && <button disabled={busy} type="button" onClick={() => void action(row, "index")} className="text-teal-800 underline">重试同步</button>}</div>
      {row.status === "DRAFT" && role === "PM" && <div className="space-y-3 border-t border-slate-100 pt-3"><label className="flex gap-2 text-xs leading-5"><input type="checkbox" checked={consents[row.id] || false} onChange={e => setConsents(s => ({ ...s, [row.id]: e.target.checked }))} />同意批准后将合成文件交由配置的解析与模型服务处理、建立索引。</label><button disabled={busy || !consents[row.id]} type="button" onClick={() => void action(row, "submit")} className="rounded-lg bg-teal-800 px-3 py-2 text-xs text-white disabled:opacity-40">提交审批</button></div>}
      {row.status === "PENDING_REVIEW" && ["QA", "ADMIN"].includes(role) && row.createdById !== userId && row.submittedById !== userId && <div className="space-y-3 border-t border-slate-100 pt-3"><label className="block text-xs">审批意见（拒绝时必填）<input maxLength={2000} value={comments[row.id] || ""} onChange={e => setComments(s => ({ ...s, [row.id]: e.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 p-2" /></label><div className="flex gap-3"><button disabled={busy} type="button" onClick={() => void action(row, "review", "APPROVED")} className="rounded-lg bg-teal-800 px-3 py-2 text-xs text-white">批准交付物</button><button disabled={busy || !comments[row.id]?.trim()} type="button" onClick={() => void action(row, "review", "REJECTED")} className="rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:opacity-40">拒绝</button></div></div>}
      {row.status === "PENDING_REVIEW" && ["QA", "ADMIN"].includes(role) && (row.createdById === userId || row.submittedById === userId) && <p className="text-xs text-amber-800">本人提交的交付物须由其他 QA / ADMIN 审批。</p>}
      {role === "PM" && <button disabled={busy} type="button" onClick={() => { setVersionOf(row); setName(row.name); setFile(null); setDocumentId(""); uploadKey.current = null; }} className="text-xs text-teal-800 underline underline-offset-4">基于 V{row.version} 上传新版本</button>}
    </article>)}
    <div className="flex items-center justify-between text-xs"><button disabled={busy || page === 1} onClick={() => setPage(n => n - 1)}>上一页</button><span>第 {page} 页</span><button disabled={busy || rows.length < 30} onClick={() => setPage(n => n + 1)}>下一页</button></div>
  </section>;
}
