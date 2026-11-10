"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";
import { useToast } from "@/components/toast-provider";
import { DOCUMENT_ACCEPT, DOCUMENT_FORMAT_HELP, uploadFileError } from "@/modules/documents/formats";
import { ParsePanel } from "@/app/projects/[projectId]/documents/parse-panel";
export type MeetingUpload = { file: File; uploadKey: string };
export function meetingUploadSelection(files: File[]) {
  if (files.length > 10) throw new Error("每次最多选择 10 个附件");
  for (const file of files) { const error = uploadFileError(file); if (error) throw new Error(`${file.name}：${error}`); }
  return files.map(file => ({ file, uploadKey: crypto.randomUUID() }));
}
export async function uploadMeetingFiles(projectId: string, meetingId: string, files: MeetingUpload[]) {
  const failed: MeetingUpload[] = []; const errors: string[] = []; let saved = 0;
  for (let offset = 0; offset < files.length; offset += 3) {
    const batch = files.slice(offset, offset + 3);
    const results = await Promise.allSettled(batch.map(async entry => {
      const form = new FormData(); form.set("file", entry.file); form.set("uploadKey", entry.uploadKey); form.set("syntheticOnly", "true");
      const response = await fetch(`/api/projects/${projectId}/meetings/${meetingId}/attachments`, { method: "POST", body: form }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || "附件上传未完成");
    }));
    results.forEach((result, index) => { if (result.status === "fulfilled") saved++; else { failed.push(batch[index]); errors.push(`${batch[index].file.name}：${result.reason instanceof Error ? result.reason.message : "上传结果未知，请刷新附件列表核实"}`); } });
  }
  return { saved, failed, errors };
}
type Attachment = { id: string; filename: string; mediaType: string; fileSize: number | null; sha256: string | null; storageStatus: string; parseStatus: string; parseVersion: number; parsedVersion: number | null };
export function MeetingAttachments({ projectId, meetingId, role, finalized, initialFiles = [] }: { projectId: string; meetingId: string; role: string; finalized: boolean; initialFiles?: MeetingUpload[] }) {
  const { capabilities } = useProjectCapabilities(); const { notify } = useToast();
  const [rows, setRows] = useState<Attachment[]>([]); const [files, setFiles] = useState(initialFiles); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [page, setPage] = useState(1); const [inputEpoch, setInputEpoch] = useState(0);
  const submitting = useRef(false); const canUpload = ["PM", "ADMIN"].includes(role) && capabilities?.writable !== false;
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/projects/${projectId}/meetings/${meetingId}/attachments?page=${page}`, { cache: "no-store", signal }); const body = await response.json();
    if (!response.ok) throw new Error(body.error || "附件列表加载失败"); if (!signal?.aborted) setRows(body.data);
  }, [projectId, meetingId, page]);
  useEffect(() => { const ac = new AbortController(); void load(ac.signal).catch(cause => { if (!ac.signal.aborted) setError(cause instanceof Error ? cause.message : "附件列表加载失败"); }); return () => ac.abort(); }, [load]);
  async function upload(event: FormEvent) {
    event.preventDefault(); if (submitting.current || !canUpload || !confirmed || !files.length) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const result = await uploadMeetingFiles(projectId, meetingId, files); setFiles(result.failed);
      if (result.failed.length) { setError(result.errors.join("；")); notify(`已上传 ${result.saved} 个附件，${result.failed.length} 个未完成，请核实后重试`, "error"); }
      else { setConfirmed(false); setInputEpoch(value => value + 1); notify("会议附件已上传并记录审计"); }
      try { await load(); } catch { notify("上传已处理，但附件列表刷新失败，请手动刷新", "error"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "附件上传状态未知，请刷新核实"); } finally { submitting.current = false; setBusy(false); }
  }
  async function recover(id: string) {
    if (submitting.current || !canUpload) return; submitting.current = true; setBusy(true);
    try { const response = await fetch(`/api/documents/${id}/recover`, { method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "附件状态恢复失败"); notify("附件状态已核验"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "恢复失败"); } finally { submitting.current = false; setBusy(false); }
  }
  return <section aria-label="会议附件" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex justify-between gap-3"><h4 className="font-semibold">会议附件</h4><button type="button" disabled={busy} onClick={() => void load().catch(() => setError("附件刷新失败，请重试"))} className="text-xs text-teal-800">刷新附件</button></div><p className="text-xs leading-6 text-slate-500">附件继承本会议可见范围，独立留存原件与哈希。定稿后可在每个附件下申请解析并同步知识库，也可追加附件，既有文件不覆盖；附件不会自动替换正文或生成行动项。</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!rows.length && <p className="text-sm text-slate-500">暂无附件</p>}
    <ul className="space-y-2">{rows.map(row => <li key={row.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">{row.storageStatus === "AVAILABLE" ? <a href={`/api/documents/${row.id}/download`} className="break-all text-teal-800 underline">下载附件 · {row.filename}</a> : <p className="break-all">{row.filename} · {row.storageStatus === "UPLOADING" ? "上传未完成" : "上传失败，请重新选择文件上传"}</p>}<p className="mt-1 text-xs text-slate-500">{row.fileSize ?? 0} 字节 · {row.mediaType}</p>{row.sha256 && <details className="mt-2 text-xs"><summary>查看原件 SHA-256</summary><p className="mt-1 break-all font-mono">{row.sha256}</p></details>}{row.storageStatus === "UPLOADING" && canUpload && <button type="button" disabled={busy} onClick={() => void recover(row.id)} className="mt-2 text-xs text-teal-800 underline">恢复中断上传</button>}{row.storageStatus === "AVAILABLE" && (finalized ? <details className="mt-3 rounded-lg border border-teal-100 p-3 text-xs"><summary className="cursor-pointer font-medium text-teal-800">知识库解析与索引</summary><ParsePanel filename={row.filename} documentId={row.id} parseStatus={row.parseStatus} parseVersion={row.parseVersion} parsedVersion={row.parsedVersion} canManage={canUpload} refresh={load} /></details> : <p className="mt-2 text-xs text-slate-500">纪要定稿后可解析附件并同步知识库。</p>)}</li>)}</ul>
    <div className="flex justify-between text-xs"><button type="button" disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>上一页附件</button><span>第 {page} 页</span><button type="button" disabled={busy || rows.length < 20} onClick={() => setPage(value => value + 1)}>下一页附件</button></div>
    {["PM", "ADMIN"].includes(role) && <form aria-label="上传会议附件" onSubmit={event => void upload(event)}><fieldset disabled={!canUpload || busy} className="space-y-3"><label className="block text-sm">选择会议附件<input key={inputEpoch} type="file" multiple accept={DOCUMENT_ACCEPT} className="mt-2 block w-full text-xs" onChange={event => { setConfirmed(false); setFiles([]); try { setFiles(meetingUploadSelection(Array.from(event.target.files ?? []))); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "文件无效"); } }} /></label><p className="text-xs text-slate-500">{DOCUMENT_FORMAT_HELP}；每次最多 10 个，每份纪要最多 20 个有效附件。</p>{files.map(entry => <p key={entry.uploadKey} className="break-all text-xs">待上传：{entry.file.name}</p>)}<label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />确认附件仅含合成数据，不含真实患者信息</label><button type="submit" disabled={!canUpload || busy || !files.length || !confirmed} className="rounded-lg bg-teal-800 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "上传中…" : "上传所选附件"}</button></fieldset></form>}
  </section>;
}
