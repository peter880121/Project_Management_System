"use client";
import { useState } from "react";
import { useToast } from "@/components/toast-provider";
export function MeetingDraftEditor({ projectId, meeting, writable, onChanged }: { projectId: string; meeting: { id: string; title: string; content: string; meetingDate: string; rowVersion: number }; writable: boolean; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(meeting.title); const [content, setContent] = useState(meeting.content); const [busy, setBusy] = useState(false); const { notify } = useToast();
  async function save(action: "save" | "finalize") {
    if (busy) return; setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/meetings/${meeting.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, expectedVersion: meeting.rowVersion, ...(action === "save" ? { title, content, meetingDate: meeting.meetingDate } : {}) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error);
      notify(action === "finalize" ? "纪要已定稿，正文只读" : "会议草稿已保存");
      try { await onChanged(); } catch { notify("保存已成功，但数据刷新失败，请手动刷新", "error"); }
    } catch (error) { notify(error instanceof Error ? error.message : "保存失败", "error"); } finally { setBusy(false); }
  }
  return <div aria-label="编辑会议草稿" className="space-y-4"><label className="block text-sm">草稿标题<input aria-label="草稿标题" value={title} maxLength={191} onChange={e => setTitle(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 p-3" disabled={!writable || busy} /></label><label className="block text-sm">草稿正文<textarea aria-label="草稿正文" value={content} maxLength={50000} rows={6} onChange={e => setContent(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm leading-6" disabled={!writable || busy} /></label><div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={!writable || busy || !title.trim() || !content.trim()} onClick={() => void save("save")} className="rounded-lg border border-slate-200 px-4 py-2 text-sm disabled:opacity-40">保存草稿修改</button><button type="button" disabled={!writable || busy || title !== meeting.title || content !== meeting.content} onClick={() => void save("finalize")} className="rounded-lg bg-teal-800 px-4 py-2 text-sm text-white disabled:opacity-40">定稿并锁定正文</button></div><p className="text-xs leading-5 text-slate-500">请先保存编辑内容，再进行 AI 提炼或定稿。定稿后正文不可覆盖，后续修改需复制为新草稿。</p></div>;
}
