"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useProjectCapabilities } from "./capabilities-context";
import { useToast } from "@/components/toast-provider";
import { projectMaintenanceSchema } from "@/modules/projects/maintenance-schema";
type Project = { id: string; name: string; description: string | null; ownerId: string | null; rowVersion: number; owner: { name: string } | null };
const inputClass = "mt-2 block w-full rounded-lg border border-slate-300 bg-white p-2.5 disabled:bg-slate-100";
export function ProjectSettings({ project, candidates, directoryOverflow }: { project: Project; candidates: { id: string; name: string }[]; directoryOverflow: boolean }) {
  const router = useRouter(); const { capabilities, refresh, epoch } = useProjectCapabilities(); const { notify } = useToast(); const saving = useRef(false);
  const [busy, setBusy] = useState(false); const [blocked, setBlocked] = useState(false); const [error, setError] = useState("");
  const editable = !!capabilities?.writable && !!capabilities.canManageMembers;
  async function save(event: FormEvent<HTMLFormElement>, operation: "details" | "transfer") {
    event.preventDefault(); if (saving.current || blocked || !editable) return;
    const form = new FormData(event.currentTarget);
    const raw = operation === "details" ? { operation, expectedRowVersion: project.rowVersion, name: form.get("name"), description: form.get("description") } : { operation, expectedRowVersion: project.rowVersion, ownerId: form.get("ownerId"), reason: form.get("reason"), confirmationName: form.get("confirmationName") };
    const parsed = projectMaintenanceSchema.safeParse(raw);
    if (!parsed.success) { setError("请完整填写信息；交接说明须为 10–1000 字。"); return; }
    if (operation === "transfer" && !window.confirm("确认交接项目负责人？原负责人将保留成员身份，但失去负责人权限及验收例外授权。")) return;
    saving.current = true; setBusy(true); setError(""); let persisted = false;
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) }); const result = await response.json();
      if (!response.ok) { if ([403, 409].includes(response.status)) { setBlocked(true); router.refresh(); await refresh(); } throw new Error(result.error || "项目保存失败"); }
      persisted = true; setBlocked(true); await refresh(); router.refresh(); notify(operation === "transfer" ? "项目负责人已交接，权限已更新" : "项目基本信息已保存");
    } catch (cause) { const message = persisted ? "修改已保存，但页面刷新失败，请手动刷新" : cause instanceof Error ? cause.message : "项目保存失败"; setError(message); notify(message, "error"); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="space-y-6" key={epoch}>
    {!editable && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">当前为只读；仅可写项目的负责人或 ADMIN 可以维护。</p>}
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">基本信息</h2><form aria-label="项目基本信息" onSubmit={event => void save(event, "details")} className="mt-4"><fieldset disabled={!editable || busy || blocked} className="space-y-4"><label className="block text-sm">项目名称<input name="name" required maxLength={191} defaultValue={project.name} className={inputClass} /></label><label className="block text-sm">项目说明<textarea name="description" rows={5} maxLength={5000} defaultValue={project.description ?? ""} className={inputClass} /></label><button className="rounded-lg bg-teal-800 px-4 py-2 text-white disabled:opacity-40">{busy ? "保存中…" : "保存项目基本信息"}</button></fieldset></form></section>
    <section className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">负责人交接</h2><p className="mt-2 text-sm text-slate-600">当前负责人：{project.owner?.name ?? "未设置"}。原负责人保留成员身份，验收例外授权撤销；新负责人不会继承该授权。</p><form aria-label="项目负责人交接" onSubmit={event => void save(event, "transfer")} className="mt-4"><fieldset disabled={!editable || busy || blocked || directoryOverflow} className="space-y-4"><label className="block text-sm">新负责人<select name="ownerId" required defaultValue="" className={inputClass}><option value="" disabled>请选择有效 PM</option>{candidates.filter(user => user.id !== project.ownerId).map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label className="block text-sm">交接说明<textarea name="reason" required minLength={10} maxLength={1000} rows={3} className={inputClass} /></label><label className="block text-sm">输入项目名称确认<input name="confirmationName" required maxLength={191} placeholder={project.name} className={inputClass} /></label><button className="rounded-lg bg-amber-800 px-4 py-2 text-white disabled:opacity-40">确认交接负责人</button></fieldset></form>{directoryOverflow && <p role="alert" className="mt-3 text-sm text-red-800">PM 目录超过展示范围，请联系管理员。</p>}</section>
    <p className="text-xs leading-6 text-slate-500">项目与任务不提供物理删除。误建或停止交付时，请使用取消流程并填写原因，保留完整历史证据。</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {blocked && <button type="button" onClick={() => window.location.reload()} className="text-sm text-teal-800 underline">重新读取最新项目信息</button>}
  </div>;
}
