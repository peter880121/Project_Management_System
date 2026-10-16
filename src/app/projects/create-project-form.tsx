"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CreateProjectForm() {
  const router = useRouter();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: values.get("name"), description: values.get("description") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "创建失败");
      router.push(`/projects?created=${encodeURIComponent(result.data.id)}`); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "网络连接失败，请核对项目列表后重试"); lock.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-6 space-y-3 rounded-xl border bg-white p-5">
    <h2 className="font-semibold">创建合成项目</h2>
    <p className="text-sm text-slate-600">仅录入合成数据。创建后你将成为项目负责人。</p>
    <label className="block text-sm">项目名称<input name="name" required maxLength={191} className="mt-1 block w-full rounded border p-2" /></label>
    <label className="block text-sm">项目描述<textarea name="description" maxLength={5000} className="mt-1 block w-full rounded border p-2" /></label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <Button disabled={busy}>{busy ? "创建中…" : "创建项目"}</Button>
  </form>;
}
