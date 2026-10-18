"use client";
import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { WbsPanel } from "@/app/projects/[projectId]/board/wbs-panel";
import { CompliancePanel, type SavedSummary } from "@/app/audit/compliance-panel";
import { useAiGeneration } from "./use-ai-generation";
import { AiGenerationPreview } from "./ai-generation-preview";
import { AiStreamError } from "@/modules/ai/streaming/client";

export type TaskAiSelection = { task: { id: string; title: string }; mode: "wbs" | "compliance" };

function TaskEvidence({ projectId, taskId, canReview, onFeedback }: { projectId: string; taskId: string; canReview: boolean; onFeedback?: (message: string, kind: "success" | "error") => void }) {
  const [summary, setSummary] = useState<SavedSummary | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { execute, stop, running, preview, stage, stopped, lastId } = useAiGeneration<SavedSummary>();
  useEffect(() => {
    let active = true;
    setError(""); setSummary(null);
    void execute("/api/audit/summary", { projectId, taskId }).then(result => {
      if (active && result) { setSummary(result); onFeedback?.("任务证据检查完成，结论仍需人工复核", "success"); }
    }).catch(cause => {
      if (active) { const message = cause instanceof Error ? cause.message : "证据检查失败，请重试"; setError(message); if (!(cause instanceof AiStreamError && cause.code === "UNAUTHORIZED")) onFeedback?.(message, "error"); }
    });
    return () => { active = false; };
  }, [projectId, taskId, attempt, onFeedback, execute]);
  async function recover() {
    if (!lastId) return;
    try {
      const response = await fetch(`/api/audit/summary?projectId=${projectId}&taskId=${taskId}&generationId=${lastId}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "尚未查到已保存结果，请稍后核对");
      setSummary(result); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "核对失败"); }
  }
  return <><AiGenerationPreview running={running} preview={preview} stage={stage} stopped={stopped} onStop={stop} />
    {stopped && <div className="mt-3 flex gap-3"><button onClick={() => void recover()}>核对已保存结果</button><button onClick={() => setAttempt(value => value + 1)}>重新检查证据</button></div>}
    {error && <div role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-red-800"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)} className="mt-3">重试证据检查</button></div>}
    {summary && <CompliancePanel key={summary.summaryId} initial={summary} canReview={canReview} />}
  </>;

}

export function TaskAiContent({ selection, projectId, role, onAccepted, onFeedback }: { selection: TaskAiSelection; projectId: string; role: string; onAccepted: () => Promise<void>; onFeedback?: (message: string, kind: "success" | "error") => void }) {
  return <div><div role="note" aria-label="AI 审计警告" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-950"><ShieldAlert aria-hidden="true" className="size-6 shrink-0" /><p>AI 建议仅供辅助，采纳后将记录审计</p></div>
    {selection.mode === "wbs" ? <WbsPanel projectId={projectId} sourceTaskId={selection.task.id} initialRequest={`请基于任务「${selection.task.title}」生成 3–5 个可执行的细化子任务建议，说明交付物、验收条件、预计工时和依赖。仅使用合成数据。`} onAccepted={onAccepted} onFeedback={onFeedback} /> : <TaskEvidence projectId={projectId} taskId={selection.task.id} canReview={role === "QA"} onFeedback={onFeedback} />}
  </div>;
}

