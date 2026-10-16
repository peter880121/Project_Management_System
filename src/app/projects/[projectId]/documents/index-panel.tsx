"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
type Status = { parsedVersion: number | null; chunkingReady: boolean; buildErrorCode: string | null; counts: Record<string, number> };
export function DocumentIndexPanel({ documentId, canManage }: { documentId: string; canManage: boolean }) {
  const [state, setState] = useState<Status | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function refresh(retry = false) {
    setBusy(true); setMessage("");
    try {
      if (retry && state?.parsedVersion) {
        const response = await fetch(`/api/documents/${documentId}/index`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: state.parsedVersion }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || "重试失败"); setMessage(body.data.queuedBuild ? "已排队重试分块；请先确认文档规模符合限制。" : `已排队重试 ${body.data.queuedChunks} 个分块。`);
      }
      const response = await fetch(`/api/documents/${documentId}/index`); const body = await response.json(); if (!response.ok) throw new Error(body.error || "查询失败"); setState(body.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); }
  }
  return <section className="mt-3 space-y-2 text-sm" aria-label="文档索引状态"><Button disabled={busy} onClick={() => void refresh()}>刷新检索就绪状态</Button>
    {state && <p>{state.parsedVersion === null ? "请先完成文档解析。" : !state.chunkingReady ? `v${state.parsedVersion} 等待分块，请确认文档 worker 正在运行。` : `v${state.parsedVersion} 已完成分块，可进行关键词检索；语义索引完成 ${state.counts.SYNCED ?? 0}，待处理 ${state.counts.PENDING ?? 0}，失败 ${state.counts.FAILED ?? 0}。`}</p>}
    {state?.buildErrorCode && <p role="alert">文档超过分块数量限制，请拆分原文档后重新上传；本次失败不会阻塞其他文档。</p>}
    {canManage && state && ((state.counts.FAILED ?? 0) > 0 || state.buildErrorCode) && <Button disabled={busy} onClick={() => void refresh(true)}>重试失败的文档索引</Button>}{message && <p role="status">{message}</p>}
  </section>;
}
