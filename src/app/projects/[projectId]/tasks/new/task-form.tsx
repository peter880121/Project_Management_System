"use client";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TaskPlanFields, taskPlanFormValues } from "@/components/tasks/task-plan-fields";
import { createTaskSchema } from "@/modules/tasks/create-schema";

export function CreateTaskForm({ projectId, requirements, selectedRequirementId }: { projectId: string; requirements: { id: string; title: string }[]; selectedRequirementId?: string }) {
  const { capabilities } = useProjectCapabilities();
  const router = useRouter();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return;
    const values = new FormData(event.currentTarget);
    lock.current = true; setBusy(true); setError("");
    try {
      const requirementId = String(values.get("requirementId") || "");
      const parsed = createTaskSchema.safeParse({ title: values.get("title"), description: String(values.get("description") || ""), ...taskPlanFormValues(values), requiresDeliverable: values.get("requiresDeliverable") === "on", ...(requirementId ? { requirementId } : {}) });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "请检查任务计划");
      const response = await fetch(`/api/projects/${projectId}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "创建任务失败");
      router.push(`/projects/${projectId}/board?createdTask=${encodeURIComponent(body.data.id)}`); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "连接失败，请确认任务列表后重试"); lock.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-8 space-y-6 rounded-2xl border border-slate-200 bg-white p-6">
    <fieldset disabled={busy || capabilities?.canEditTasks === false} className="space-y-6">
    <label className="flex items-start gap-2 text-sm"><input name="requiresDeliverable" type="checkbox" disabled={busy || capabilities?.canEditTasks === false} />📎 完成前必须有审批通过的交付物</label>
    <label className="block space-y-2 text-sm font-medium">任务标题<input aria-label="任务标题" name="title" required maxLength={191} disabled={busy || capabilities?.canEditTasks === false} className="block w-full rounded-md border border-slate-300 p-3" /></label>
    <TaskPlanFields />
    <label className="block space-y-2 text-sm font-medium">任务说明<textarea name="description" aria-label="任务说明" maxLength={9900} rows={3} className="block w-full rounded-lg border border-slate-300 p-3" /></label>
    <label className="block space-y-2 text-sm font-medium">关联需求<select name="requirementId" defaultValue={selectedRequirementId ?? ""} disabled={busy || capabilities?.canEditTasks === false} className="block w-full rounded-md border border-slate-300 bg-white p-3"><option value="">不关联需求</option>{requirements.map(requirement => <option key={requirement.id} value={requirement.id}>{requirement.title}</option>)}</select></label>
    <p className="text-sm text-slate-500">仅录入合成内容。暂不关联需求的任务会在合规追溯检查中被标记。</p>
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <Button disabled={busy || capabilities?.canEditTasks === false} aria-busy={busy}>{busy ? "创建中…" : "创建任务"}</Button>
    </fieldset>
  </form>;
}
