"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CreateTaskForm({ projectId, requirements }: { projectId: string; requirements: { id: string; title: string }[] }) {
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
      const response = await fetch(`/api/projects/${projectId}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: values.get("title"), requiresDeliverable: values.get("requiresDeliverable") === "on", ...(requirementId ? { requirementId } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "创建任务失败");
      router.push(`/projects/${projectId}/board?createdTask=${encodeURIComponent(body.data.id)}`); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "连接失败，请确认任务列表后重试"); lock.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-8 space-y-6 rounded-2xl border border-slate-200 bg-white p-6">
    <label className="flex items-start gap-2 text-sm"><input name="requiresDeliverable" type="checkbox" disabled={busy} />📎 完成前必须有审批通过的交付物</label>
    <label className="block space-y-2 text-sm font-medium">任务标题<input aria-label="任务标题" name="title" required maxLength={191} disabled={busy} className="block w-full rounded-md border border-slate-300 p-3" /></label>
    <label className="block space-y-2 text-sm font-medium">关联需求<select name="requirementId" disabled={busy} className="block w-full rounded-md border border-slate-300 bg-white p-3"><option value="">不关联需求</option>{requirements.map(requirement => <option key={requirement.id} value={requirement.id}>{requirement.title}</option>)}</select></label>
    <p className="text-sm text-slate-500">仅录入合成内容。暂不关联需求的任务会在合规追溯检查中被标记。</p>
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <Button disabled={busy} aria-busy={busy}>{busy ? "创建中…" : "创建任务"}</Button>
  </form>;
}
