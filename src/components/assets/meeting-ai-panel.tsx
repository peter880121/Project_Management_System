"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Square, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/toast-provider";
import { AiStreamError, readAiResponse, Typewriter } from "@/modules/ai/streaming/client";
import { MAX_TRANSCRIPT_CHARACTERS, summaryResultSchema, type MeetingActionItem, type MeetingSummaryResult } from "@/modules/ai/meetings/types";
import { ActionItemTaskDialog } from "./action-item-task-dialog";

export function MeetingAiPanel({ projectId, meeting, writable, onChanged, onLinked }: { projectId: string; meeting: { id: string; rowVersion: number; status: string; actionItems: MeetingActionItem[] }; writable: boolean; onChanged: () => Promise<void>; onLinked: (item: MeetingActionItem, taskId: string) => void }) {
  const [text, setText] = useState(""); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState(""); const [progress, setProgress] = useState(""); const [result, setResult] = useState<MeetingSummaryResult | null>(null); const [dialogItem, setDialogItem] = useState<MeetingActionItem | null>(null); const [applying, setApplying] = useState(false);
  const controller = useRef<AbortController | null>(null); const writer = useRef<Typewriter | null>(null); const locked = useRef(false); const { notify } = useToast();
  useEffect(() => {
    const ac = new AbortController(); const recoveryGeneration = controller.current;
    void fetch(`/api/projects/${projectId}/meetings/${meeting.id}/summarize`, { cache: "no-store", signal: ac.signal }).then(async res => {
      if (!res.ok) return; const body = await res.json(); const recovered = summaryResultSchema.safeParse(body.data?.[0]);
      if (!ac.signal.aborted && controller.current === recoveryGeneration && recovered.success) { setResult(recovered.data); setPreview(recovered.data.summary); }
    }).catch(() => {});
    return () => { ac.abort(); controller.current?.abort(); writer.current?.stop(); };
  }, [projectId, meeting.id]);
  function stop() { controller.current?.abort(); writer.current?.stop(); setProgress("已停止生成，已保存的建议可刷新查看"); setBusy(false); }
  async function generate() {
    if (locked.current) return; if (text.length > MAX_TRANSCRIPT_CHARACTERS) { notify("文本过长，请分段提炼", "error"); return; }
    locked.current = true; const ac = new AbortController(); controller.current = ac; writer.current?.stop(); const animation = new Typewriter(value => setPreview(old => old + value)); writer.current = animation;
    setBusy(true); setPreview(""); setResult(null); setProgress("正在连接 AI…");
    try {
      const response = await fetch(`/api/projects/${projectId}/meetings/${meeting.id}/summarize`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-Generation-Id": crypto.randomUUID() }, body: JSON.stringify({ text, expectedVersion: meeting.rowVersion, syntheticDataConfirmed: true }), signal: ac.signal });
      const output = await readAiResponse<unknown>(response, ac.signal, event => {
        if (event.event === "delta") animation.enqueue(event.data.text);
        if (event.event === "progress") setProgress(event.data.message);
      });
      ac.signal.throwIfAborted(); const parsed = summaryResultSchema.parse(output); animation.stop(); setPreview(parsed.summary); setResult(parsed); setProgress("提炼完成 · 等待人工确认");
    } catch (error) {
      animation.stop(); if (!ac.signal.aborted) { notify(error instanceof Error ? error.message : "AI 提炼失败", "error"); setProgress("未完成提炼，请重试或手动整理"); if (error instanceof AiStreamError && ["UNAUTHORIZED", "PROJECT_ARCHIVED", "PROJECT_FROZEN"].includes(error.code)) window.dispatchEvent(new CustomEvent("project-access-invalidated", { detail: { code: error.code } })); }
    } finally { locked.current = false; if (!ac.signal.aborted) setBusy(false); }
  }
  async function apply() {
    if (!result || locked.current) return; locked.current = true; setApplying(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/meetings/${meeting.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", suggestionId: result.suggestionId, expectedVersion: meeting.rowVersion }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "采纳失败");
      notify("AI 摘要与行动项已采用到草稿"); setResult(null); try { await onChanged(); } catch { notify("采纳已成功，但数据刷新失败，请手动刷新", "error"); }
    } catch (error) { notify(error instanceof Error ? error.message : "采纳失败", "error"); } finally { locked.current = false; setApplying(false); }
  }
  const byId = new Map<string, MeetingActionItem>(result?.actionItems.map(item => [item.id, item]) ?? []); meeting.actionItems.forEach(item => byId.set(item.id, item)); const items = [...byId.values()];
  return <section aria-label="AI 会议提炼" className="space-y-5 rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 via-white to-cyan-50/50 p-5">
    <div className="flex items-start gap-3"><div className="rounded-xl bg-teal-800 p-2.5 text-white"><Sparkles className="size-5" /></div><div><h3 className="font-semibold text-slate-900">AI 提炼纪要</h3><p className="mt-1 text-xs leading-5 text-slate-500">将讨论转为清晰决策与行动。所有建议均需人工确认。</p></div></div>
    {meeting.status === "DRAFT" && <><label className="block text-sm font-medium">会议转写稿<textarea aria-label="会议转写稿" rows={6} value={text} disabled={busy || !writable} onChange={e => setText(e.target.value)} placeholder="粘贴合成会议记录。建议明确讨论结论、负责人和时间。" className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-normal leading-6 focus:border-teal-500" /></label><div className={`text-right text-xs ${text.length > MAX_TRANSCRIPT_CHARACTERS ? "text-red-700" : "text-slate-500"}`}>{text.length} / {MAX_TRANSCRIPT_CHARACTERS} 字{text.length > MAX_TRANSCRIPT_CHARACTERS && " · 文本过长，请分段提炼"}</div><label className="flex gap-2 text-xs leading-6 text-slate-600"><input type="checkbox" checked={confirmed} disabled={busy || !writable} onChange={e => setConfirmed(e.target.checked)} />我确认仅包含合成数据，同意发送至配置的 AI 服务。</label><div className="flex gap-3"><button type="button" disabled={!writable || busy || applying || !confirmed || text.trim().length < 10 || text.length > MAX_TRANSCRIPT_CHARACTERS} onClick={() => void generate()} className="inline-flex items-center gap-2 rounded-lg border-0 bg-teal-800 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"><Sparkles className="size-4" />{busy ? "提炼中…" : "AI 提炼纪要"}</button>{busy && <button type="button" onClick={stop} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm"><Square className="size-3" />停止生成</button>}</div></>}
    {(progress || preview) && <div aria-label="AI 摘要预览" className="rounded-xl border border-teal-100 bg-white p-4"><p role="status" className="mb-3 flex items-center gap-2 text-xs font-medium text-teal-800">{busy && <span className="size-2 animate-pulse rounded-full bg-teal-500" />}{progress || "待确认建议"}</p><p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{preview}{busy && <span aria-hidden="true" className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-teal-600" />}</p>{result && meeting.status === "DRAFT" && <button type="button" disabled={!writable || applying || busy} onClick={() => void apply()} className="mt-4 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900 disabled:opacity-40">{applying ? "正在采用…" : "应用到纪要草稿"}</button>}</div>}
    <div className="space-y-3"><div className="flex items-center justify-between"><h4 className="text-sm font-semibold">行动项</h4><span className="text-xs text-slate-500">{items.length} 条 · 人工决定</span></div>{!items.length && <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-5 text-center text-xs text-slate-500">尚无行动项。提炼后可逐条确认并转为任务。</p>}{items.map((item, index) => <article key={item.id} aria-label={`行动项：${item.text}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">{item.text}</p><p className="mt-2 text-xs leading-5 text-slate-500">建议负责人：{item.suggestedAssigneeName || "待确认"}<span className="mx-2">·</span>预期完成：{item.expectedDueDate || "待确认"}</p></div></div><div className="mt-4 flex justify-end border-t border-slate-100 pt-3">{item.taskId ? <Link href={`/projects/${projectId}/board?taskId=${item.taskId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-800"><CheckCircle2 className="size-4" />已转任务 · 查看</Link> : <button type="button" disabled={!writable || busy || applying || meeting.status !== "DRAFT"} onClick={() => setDialogItem(item)} className="inline-flex items-center gap-1 rounded-lg border-0 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900 disabled:opacity-40">转为任务<ArrowUpRight className="size-3.5" /></button>}</div></article>)}</div>
    {dialogItem && <ActionItemTaskDialog key={dialogItem.id} projectId={projectId} meetingId={meeting.id} rowVersion={meeting.rowVersion} item={dialogItem} onClose={() => setDialogItem(null)} onCreated={taskId => { onLinked(dialogItem, taskId); setResult(previous => previous && ({ ...previous, actionItems: previous.actionItems.map(item => item.id === dialogItem.id ? { ...item, taskId } : item) })); }} />}
  </section>;
}
