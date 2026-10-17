"use client";
import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { WbsPanel } from "@/app/projects/[projectId]/board/wbs-panel";
import { CompliancePanel, type SavedSummary } from "@/app/audit/compliance-panel";
import { Skeleton } from "@/components/ui/skeleton";

export type TaskAiSelection = { task: { id: string; title: string }; mode: "wbs" | "compliance" };

function TaskEvidence({ projectId, taskId, canReview, onFeedback }: { projectId: string; taskId: string; canReview: boolean; onFeedback?: (message: string, kind: "success" | "error") => void }) {
  const [summary, setSummary] = useState<SavedSummary | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setSummary(null);
    void (async () => {
      try {
        const response = await fetch("/api/audit/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, taskId }), signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "证据检查失败");
        setSummary(result);
        onFeedback?.("任务证据检查完成，结论仍需人工复核", "success");
      } catch (cause) { if (!controller.signal.aborted) { const message = cause instanceof Error ? cause.message : "证据检查失败，请重试"; setError(message); onFeedback?.(message, "error"); } }
    })();
    return () => controller.abort();
  }, [projectId, taskId, attempt, onFeedback]);
  return <>{error ? <div role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-red-800"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)} className="mt-3">重试证据检查</button></div> : summary ? <CompliancePanel key={summary.summaryId} initial={summary} canReview={canReview} /> : <div role="status" aria-label="正在检查合规证据" className="space-y-4 py-6"><span className="sr-only">正在检查当前任务的需求、测试与审计证据</span><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-32 w-full" /></div>}</>;
}

export function TaskAiContent({ selection, projectId, role, onAccepted, onFeedback }: { selection: TaskAiSelection; projectId: string; role: string; onAccepted: () => Promise<void>; onFeedback?: (message: string, kind: "success" | "error") => void }) {
  return <div><div role="note" aria-label="AI 审计警告" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-950"><ShieldAlert aria-hidden="true" className="size-6 shrink-0" /><p>AI 建议仅供辅助，采纳后将记录审计</p></div>
    {selection.mode === "wbs" ? <WbsPanel projectId={projectId} sourceTaskId={selection.task.id} initialRequest={`请基于任务「${selection.task.title}」生成 3–5 个可执行的细化子任务建议，说明交付物、验收条件、预计工时和依赖。仅使用合成数据。`} onAccepted={onAccepted} onFeedback={onFeedback} /> : <TaskEvidence projectId={projectId} taskId={selection.task.id} canReview={role === "QA"} onFeedback={onFeedback} />}
  </div>;
}

