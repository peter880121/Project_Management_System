"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
type Notification = { id: string; title: string; readAt: string | null; createdAt: string; status: string; sourceUrl: string };
export function NotificationPanel() {
  const [page, setPage] = useState(1); const [rows, setRows] = useState<Notification[]>([]); const [unread, setUnread] = useState(0); const [hasMore, setHasMore] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/notifications?page=${page}`); const body = await response.json(); if (!response.ok) throw new Error(body.error || "查询失败"); setRows(body.data); setUnread(body.unreadCount); setHasMore(body.hasMore);
  }, [page]);
  useEffect(() => { void load().catch(() => setError("通知暂时无法读取，请刷新")); }, [load]);
  async function refresh(id?: string) {
    setBusy(true); setError("");
    try { if (id) { const response = await fetch(`/api/notifications/${id}/read`, { method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "更新失败"); } await load(); }
    catch (error) { setError(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3" aria-label="个人风险通知"><div className="flex gap-4"><p>未读通知：{unread}</p><button disabled={busy} onClick={() => void refresh()} className="text-teal-800 underline">刷新通知</button></div>{error && <p role="alert">{error}</p>}{rows.map((row) => <article key={row.id} className="space-y-2 rounded border p-4"><h2 className="font-semibold">{row.title}</h2><p>{row.readAt ? "已读" : "未读"} · {new Date(row.createdAt).toLocaleString()} · {row.status === "PENDING" ? "风险待处置" : "风险已有处置决定"}</p><Link href={row.sourceUrl} className="text-teal-800 underline">查看风险依据</Link>{!row.readAt && <button disabled={busy} onClick={() => void refresh(row.id)} className="ml-4 rounded border px-3 py-1">标为已读</button>}</article>)}{!rows.length && <p>暂无风险通知。</p>}<div className="flex gap-4"><button disabled={busy || page === 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {page} 页</span><button disabled={busy || !hasMore} onClick={() => setPage((value) => value + 1)}>下一页</button></div></section>;
}
