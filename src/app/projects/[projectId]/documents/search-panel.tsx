"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
type SearchResult = { degraded: boolean; durationMs: number; hits: { id: string; documentId: string; filename: string; version: number; ordinal: number; page: number | null; text: string; sourceUrl: string }[] };
export function DocumentSearchPanel({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [result, setResult] = useState<SearchResult | null>(null);
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/documents/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "检索失败"); setResult(body.data);
    } catch (error) { setError(error instanceof Error ? error.message : "检索失败"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border p-4" aria-label="文档检索">
    <h2 className="text-xl font-semibold">检索项目文档</h2><p className="text-sm text-slate-600">检索各文档最新成功解析版本，结果保留来源页码与版本；尚未完成分块的文档暂不参与检索。</p>
    <form onSubmit={(event) => void search(event)} className="flex gap-3"><input aria-label="文档检索词" value={query} onChange={(event) => setQuery(event.target.value)} required maxLength={2000} placeholder="输入需求、验收条件或关键词" className="min-w-0 flex-1 rounded border p-2" /><Button disabled={busy}>{busy ? "检索中…" : "检索文档"}</Button></form>
    {error && <p role="alert">{error}</p>}
    {result && <div role="status" className="space-y-3"><p>{result.degraded ? "已使用关键词检索，语义检索暂不可用或没有当前版本命中。" : "已使用语义检索。"} 命中 {result.hits.length} 条 · {result.durationMs} ms</p>
      {result.hits.map((hit) => <article key={hit.id} className="space-y-2 rounded border bg-slate-50 p-3"><Link href={hit.sourceUrl} className="font-semibold text-teal-800 underline">{hit.filename} · v{hit.version} · {hit.page === null ? "无页码" : `第 ${hit.page} 页`} · 分块 {hit.ordinal + 1}</Link><p className="whitespace-pre-wrap break-words text-sm">{hit.text}</p></article>)}
      {!result.hits.length && <p>没有找到匹配内容，请确认解析及分块已完成，或调整关键词。</p>}
    </div>}
  </section>;
}
