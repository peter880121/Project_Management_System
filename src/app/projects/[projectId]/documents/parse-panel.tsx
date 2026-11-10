"use client";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";
import { useState, type FormEvent } from "react";
import { documentFormat } from "@/modules/documents/formats";
import { Button } from "@/components/ui/button";
import { DocumentIndexPanel } from "./index-panel";
type Job = { id: string; version: number; status: string; phase: string; errorCode: string | null; modelVersion: string; createdAt: string };
type Preview = { version: number; markdown: string; blocks: { text: string; page: number | null; type: string }[]; modelVersion: string; completedAt: string; previewTruncated: boolean; totalBlocks: number };
const parseErrors: Record<string, string> = { DOCUMENT_LOCAL_PARSE_INVALID: "文档结构或编码无法解析，请检查文件后上传新版本", DOCUMENT_TEXT_LIMIT: "提取文本超过 200 万字符，请拆分文档", PARSE_SOURCE_INTEGRITY: "原文件完整性校验失败，请联系管理员核验存储", ASSET_NOT_APPROVED: "交付物尚未审批通过，暂不解析" };
const names: Record<string, string> = { NOT_REQUESTED: "尚未申请解析", QUEUED: "等待 worker", RUNNING: "解析中", SUCCEEDED: "解析成功", FAILED: "解析失败" };
export function ParsePanel({ filename, documentId, parseStatus, parseVersion, parsedVersion, canManage, refresh }: { filename: string; documentId: string; parseStatus: string; parseVersion: number; parsedVersion: number | null; canManage: boolean; refresh: () => Promise<void> }) {
  const { capabilities } = useProjectCapabilities(); const cloud = documentFormat(filename)?.cloud ?? true;
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]); const [preview, setPreview] = useState<Preview | null>(null);
  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/documents/${documentId}/${parseStatus === "FAILED" ? "retry" : "parse"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey: crypto.randomUUID(), expectedVersion: parseVersion, cloudProcessingConfirmed: cloud }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "提交失败");
      setMessage(`解析 v${result.data.version} 已排队，原文件仍可下载。`); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); }
  }
  async function history() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/documents/${documentId}/parse`); const result = await response.json(); if (!response.ok) throw new Error(result.error || "查询失败");
      setJobs(result.data); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); }
  }
  async function open(version: number) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/documents/${documentId}/preview?version=${version}`); const result = await response.json(); if (!response.ok) throw new Error(result.error || "预览失败");
      setPreview(result.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); }
  }
  return <section className="mt-4 space-y-3 rounded-lg border bg-slate-50 p-4" aria-label="文档解析">
    <h3 className="font-semibold">{names[parseStatus]} · 当前申请 v{parseVersion}</h3>
    {parsedVersion !== null && <p className="text-sm">可预览成功版本 v{parsedVersion}；新解析失败不会覆盖旧结果。</p>}
    {canManage && !["QUEUED", "RUNNING"].includes(parseStatus) && <form onSubmit={(event) => void queue(event)} className="space-y-2">{cloud ? <label className="flex items-start gap-2 text-sm"><input required type="checkbox" />确认将此合成 PDF 发送到 MinerU 云端处理，文件不含真实患者信息。</label> : <p className="text-sm text-teal-800">本地解析，不发送至 MinerU；仅提取文字，不执行宏或加载外部资源。</p>}<Button disabled={capabilities?.writable === false || busy}>{parseStatus === "FAILED" ? "重试解析" : parseVersion ? "重新解析" : "开始解析"}</Button></form>}
    <div className="flex gap-3"><Button disabled={busy} onClick={() => void history()}>刷新解析任务</Button>{parsedVersion !== null && <Button disabled={busy} onClick={() => void open(parsedVersion)}>预览解析结果</Button>}</div>
    {jobs.map((job) => <div key={job.id} className="rounded border p-2 text-sm">v{job.version} · {names[job.status]} · {job.modelVersion}{job.errorCode && <p>{parseErrors[job.errorCode] ?? `解析失败：${job.errorCode}`}</p>}{job.status === "SUCCEEDED" && <button className="ml-3 text-teal-800 underline" disabled={busy} onClick={() => void open(job.version)}>查看 v{job.version}</button>}</div>)}
    {preview && <div className="space-y-3"><h4 className="font-semibold">解析预览 v{preview.version}</h4>{preview.previewTruncated && <p className="text-sm text-amber-800">长文仅展示部分内容，完整结果已保留；当前预览不代表全文。</p>}<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border bg-white p-3 text-sm">{preview.markdown}</pre><details><summary>结构化内容与来源位置（展示 {preview.blocks.length}/{preview.totalBlocks}）</summary>{preview.blocks.length === 0 && <p>结果没有可用页码信息，不推测来源页。</p>}{preview.blocks.map((block, index) => <p key={index} className="mt-2 whitespace-pre-wrap text-sm">{block.page === null ? `段落/结构块 ${index + 1}（无页码）` : `第 ${block.page} 页`} · {block.text}</p>)}</details></div>}
    {parsedVersion !== null && <DocumentIndexPanel documentId={documentId} canManage={canManage} />}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
