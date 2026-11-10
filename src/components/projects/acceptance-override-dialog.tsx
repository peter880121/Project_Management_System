"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDialogToasts, ToastViewport, useToast } from "@/components/toast-provider";
import { useProjectCapabilities } from "./capabilities-context";
import { useAcceptanceCheck } from "./acceptance-check-context";
export function AcceptanceOverrideDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { check, remember, expire } = useAcceptanceCheck(); const { capabilities, refresh } = useProjectCapabilities(); const { notify } = useToast(); const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null); const lock = useRef(false); const key = useRef(crypto.randomUUID()); const [reason, setReason] = useState(""); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); useDialogToasts();
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  async function submit() {
    if (!check || !capabilities?.canOverrideAcceptance || lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/submit-acceptance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRowVersion: capabilities.rowVersion, requestKey: key.current, checkId: check.checkId, override: true, overrideReason: reason }) }); const body = await response.json();
      if (!response.ok) { if ([400, 409].includes(response.status) && body.code === "CHECK_STALE") { onClose(); expire(); return; } throw new Error(body.error || "风险提交失败"); }
      remember(null); notify("已带风险提交待审，缺口及特权说明已记录审计"); onClose();
      try { await refresh(); router.refresh(); } catch { notify("风险提交已成功，但数据刷新失败，请手动刷新", "error"); }
    } catch (e) { setError(e instanceof Error ? e.message : "连接中断，请核对验收状态后重试"); } finally { lock.current = false; setBusy(false); }
  }
  return <dialog ref={ref} aria-label="特权风险提交" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} className="m-auto w-[min(94vw,580px)] rounded-2xl border-0 bg-white p-6 shadow-2xl backdrop:bg-slate-950/45"><h2 className="text-xl font-semibold text-red-900">⚠️ 带风险提交验收</h2><div className="my-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-7 text-amber-950">当前存在 <strong>{check?.totalGaps ?? 0}</strong> 个合规缺口。本操作仅将项目送交 QA 审查，不会补齐证据，也不会豁免最终归档条件。提交后业务资料将锁定；整改需先撤回或驳回。</div><label className="block text-sm font-medium">特权说明<textarea aria-label="特权说明" rows={5} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} placeholder="说明为何需要带风险送审、当前风险、责任人与整改安排（至少 20 字）。" className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm leading-6" /></label><label className="mt-4 flex gap-2 text-xs leading-6 text-slate-600"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />我已核对当前缺口，确认以本人授权提交风险说明，知悉 QA 和 ADMIN 仍会执行硬性检查。</label>{error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}<div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">取消</button><button type="button" disabled={busy || !confirmed || reason.trim().length < 20 || !capabilities?.canOverrideAcceptance} onClick={() => void submit()} className="rounded-lg bg-red-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "正在提交…" : "确认带风险提交"}</button></div><ToastViewport /></dialog>;
}
