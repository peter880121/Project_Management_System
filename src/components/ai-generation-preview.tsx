"use client";
export function AiGenerationPreview({ running, preview, stage, stopped, onStop, retrying = false }: { running: boolean; preview: string; stage: string; stopped: boolean; onStop: () => void; retrying?: boolean }) {
  if (!running && !preview && !stopped) return null;
  return <section aria-label="AI 流式生成预览" aria-busy={running} className="mt-4 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-teal-950">{running ? retrying ? "正在重试…" : "思考中…" : stopped ? "已停止" : "生成预览"}</h3>{running && <button type="button" onClick={onStop} className="shrink-0 rounded-md border border-teal-700 bg-white px-3 py-2 text-sm text-teal-900">停止生成</button>}</div>
    <p role="status" className="mt-2 text-xs text-teal-800">{stage}</p>
    <p className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-slate-800">{preview || "正在准备任务上下文与证据…"}{running && <span aria-hidden="true" className="ml-1 animate-pulse">▍</span>}</p>
    <p className="mt-2 text-xs text-slate-500">公开执行说明与未校验预览，仅供展示；最终建议需人工确认。</p>
  </section>;
}
