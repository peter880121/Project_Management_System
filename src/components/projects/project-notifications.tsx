"use client";
import Link from "next/link";
import { useState } from "react";
type Notice = { id: string; projectId: string; readAt: string | null; createdAt: string; project: { name: string } };
export function ProjectNotifications() {
  const [open, setOpen] = useState(false); const [rows, setRows] = useState<Notice[]>([]); const [error, setError] = useState("");
  async function toggle() { setOpen(value => !value); if (open) return; try { const res = await fetch("/api/project-notifications", { cache: "no-store" }); if (!res.ok) throw new Error(); setRows((await res.json()).data); setError(""); } catch { setError("通知暂时无法读取"); } }
  return <div className="relative shrink-0"><button type="button" aria-expanded={open} onClick={() => void toggle()} className="rounded-lg border border-slate-200 px-2 py-2 text-xs text-teal-800">结项通知</button>{open && <section aria-label="项目结项通知" className="absolute right-0 top-11 z-50 max-h-96 w-72 max-w-[85vw] space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl"><h2 className="font-semibold">项目结项通知</h2>{error && <p role="alert" className="text-xs text-red-800">{error}</p>}{rows.map(row => <article key={row.id} className="rounded-lg bg-slate-50 p-3 text-xs"><Link onClick={() => { setOpen(false); void fetch(`/api/project-notifications/${row.id}/read`, { method: "POST" }); }} href={`/projects/${row.projectId}/acceptance`} className="font-medium text-teal-800 underline">{row.project.name} · 已归档</Link><p className="mt-2 text-slate-500">{new Date(row.createdAt).toLocaleString()} · {row.readAt ? "已读" : "未读"}</p></article>)}{!rows.length && !error && <p className="text-xs text-slate-500">暂无结项通知</p>}</section>}</div>;
}
