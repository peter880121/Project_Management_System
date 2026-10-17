"use client";
import { canRefineTask, canCheckTaskEvidence } from "@/modules/ai/task-actions";
import type { TaskAiSelection } from "./task-ai-drawer";
import { Sparkles, ShieldCheck } from "lucide-react";

export function TaskAiActions({ task, role, onSelect, compact = false }: { task: { id: string; title: string }; role: string; onSelect: (selection: TaskAiSelection) => void; compact?: boolean }) {
  return <div className="flex flex-wrap gap-1.5">
    {role === "PM" && canRefineTask(task.title) && <button aria-label="✨ 细化子任务" title="细化子任务" data-task-ai-trigger={`${task.id}:wbs`} type="button" onClick={event => { event.stopPropagation(); onSelect({ task, mode: "wbs" }); }} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border-indigo-200 bg-indigo-50 p-1.5 text-xs font-medium text-indigo-900"><Sparkles aria-hidden="true" className="size-4" />{!compact && "细化子任务"}</button>}
    {["PM", "ADMIN", "QA"].includes(role) && canCheckTaskEvidence(task.title) && <button aria-label="🛡️ 检查合规证据" title="检查合规证据" data-task-ai-trigger={`${task.id}:compliance`} type="button" onClick={event => { event.stopPropagation(); onSelect({ task, mode: "compliance" }); }} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border-teal-200 bg-teal-50 p-1.5 text-xs font-medium text-teal-900"><ShieldCheck aria-hidden="true" className="size-4" />{!compact && "检查合规证据"}</button>}
  </div>;
}
