"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { ParsePanel } from "./parse-panel";
type DocumentRow = { id: string; filename: string; storageStatus: "LEGACY" | "UPLOADING" | "AVAILABLE" | "FAILED"; fileSize: number | null; sha256: string | null; createdAt: string; errorCode: string | null; parseStatus: string; parseVersion: number; parsedVersion: number | null };
const statusNames = { LEGACY: "历史文件待核验", UPLOADING: "上传处理中", AVAILABLE: "可下载", FAILED: "上传失败" };
export function DocumentsManager({ projectId, role }: { projectId: string; role: Role }) {
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const uploadKey = useRef<string | null>(null);
  const load = useCallback(async (target: number) => {
    setLoadError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/documents?page=${target}`); const result = await response.json();
      if (!response.ok) throw new Error(result.error || "列表加载失败");
      setRows(result.data); setPage(target);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "连接失败"); }
  }, [projectId]);
  useEffect(() => { void load(1); }, [load]);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    uploadKey.current ??= crypto.randomUUID(); data.set("uploadKey", uploadKey.current);
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body: data }); const result = await response.json();
      if (!response.ok) throw new Error(result.error || "上传失败");
      form.reset(); uploadKey.current = null; setMessage("文档已保存并记录审计。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "网络连接失败；可重试同一次上传"); }
    finally { setBusy(false); await load(1); }
  }
  async function action(id: string, name: "recover" | "cleanup") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/documents/${id}/${name}`, { method: "POST" }); const result = await response.json();
      if (!response.ok) throw new Error(result.error || "操作失败");
      setMessage(name === "recover" ? "已核验中断上传状态。" : `已清理 ${result.data.removed} 项对象；失败记录仍可重试。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); await load(page); }
  }
  return <div className="space-y-4">
    {role === "PM" && <form onSubmit={(event) => void upload(event)} className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">上传 PDF</h2><label className="block">选择 PDF<input aria-label="选择 PDF" type="file" name="file" accept="application/pdf,.pdf" required className="block p-2" onChange={() => { uploadKey.current = null; }} /></label><label className="flex gap-2"><input type="checkbox" name="syntheticOnly" value="true" required />确认文件仅含合成数据，不含真实患者信息</label><Button disabled={busy}>上传文档</Button><Button type="button" disabled={busy} variant="outline" onClick={() => { uploadKey.current = null; setMessage("已准备新的上传，请确认之前的文件状态后提交。"); }}>开始新的上传</Button></form>}
    {message && <p role="status">{message}</p>}{loadError && <p role="alert">{loadError}</p>}
    <div className="flex items-center gap-3"><Button disabled={busy} onClick={() => void load(page)}>刷新列表</Button><Button disabled={busy || page === 1} onClick={() => void load(page - 1)}>上一页</Button><span>第 {page} 页</span><Button disabled={busy || rows.length < 20} onClick={() => void load(page + 1)}>下一页</Button></div>
    {rows.length === 0 && !loadError && <p>暂无文档。</p>}
    {rows.map((row) => <article key={row.id} className="space-y-2 rounded-xl border bg-white p-5"><h2 className="font-semibold">{row.filename}</h2><p>{statusNames[row.storageStatus]} · {row.fileSize === null ? "大小待核验" : `${row.fileSize} 字节`}</p>{row.sha256 && <p className="break-all text-xs text-slate-600">SHA-256：{row.sha256}</p>}{row.storageStatus === "AVAILABLE" && <a className="text-teal-800 underline" href={`/api/documents/${row.id}/download`}>下载原文件</a>}{["PM", "ADMIN"].includes(role) && row.storageStatus === "UPLOADING" && <Button disabled={busy} onClick={() => void action(row.id, "recover")}>恢复中断上传</Button>}{["PM", "ADMIN"].includes(role) && row.storageStatus === "FAILED" && <><p className="text-sm text-slate-600">可重新上传文件；如果有残留对象，可重试清理。</p><Button disabled={busy} onClick={() => void action(row.id, "cleanup")}>重试对象清理</Button></>}{row.storageStatus === "AVAILABLE" && <ParsePanel documentId={row.id} parseStatus={row.parseStatus} parseVersion={row.parseVersion} parsedVersion={row.parsedVersion} canManage={["PM", "ADMIN"].includes(role)} refresh={() => load(page)} />}</article>)}
  </div>;
}
