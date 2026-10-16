"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function VersionReview({ projectId, entityType, entityId, requirementId, version, reviewedVersion, updatedAt, canReview }: { projectId: string; entityType: "Task" | "TestCase"; entityId: string; requirementId: string; version: number; reviewedVersion: number | null; updatedAt: string; canReview: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = new FormData(event.currentTarget).get("note");
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/compliance/requirement-reviews`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType, entityId, expectedRequirementId: requirementId, expectedRequirementVersion: version, expectedUpdatedAt: updatedAt, note }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "复核失败");
      setMessage("需求版本复核已保存。"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); }
  }
  return <div className="my-2 rounded border bg-slate-50 p-3 text-sm"><p>当前需求 v{version} · 已复核版本：{reviewedVersion ?? "未复核"} {reviewedVersion !== null && reviewedVersion !== version ? "（已过期）" : ""}</p>{canReview && reviewedVersion !== version && <form onSubmit={(event) => void submit(event)} className="mt-2 space-y-2"><label>版本复核说明<textarea aria-label="版本复核说明" name="note" required maxLength={2000} className="block w-full rounded border p-2" /></label><Button disabled={busy}>确认适配当前需求版本</Button></form>}{message && <p role="status">{message}</p>}</div>;
}
