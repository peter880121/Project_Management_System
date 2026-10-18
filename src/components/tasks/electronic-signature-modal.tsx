"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { SIGNATURE_REASONS, signatureSchema } from "@/modules/tasks/signature";
import { ToastViewport, useDialogToasts, useToast } from "../toast-provider";
import type { TaskCompletion } from "./board-types";

export function ElectronicSignatureModal({ task, actualHours = "", onClose, onConfirm }: { task: { id: string; title: string }; actualHours?: string; onClose: () => void; onConfirm: (value: TaskCompletion) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState<string>(SIGNATURE_REASONS[0]);
  const [hours, setHours] = useState(actualHours);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { notify } = useToast();
  useDialogToasts();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previousFocus?.focus(); };
  }, []);
  function close() { if (!submitting.current) { setPassword(""); onClose(); } }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const parsed = signatureSchema.safeParse({ signaturePassword: password, signatureReason: reason });
    if (!parsed.success || !(Number(hours) > 0 && Number(hours) <= 10000)) { setError("请填写有效的密码、签名意图和实际工时"); return; }
    submitting.current = true; setBusy(true); setError("");
    try {
      await onConfirm({ status: "DONE", actualHours: Number(hours), ...parsed.data });
      setPassword(""); onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "签署失败，请核对任务状态后重试";
      setError(message); notify(message, "error");
    } finally { setPassword(""); setVisible(false); submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby="signature-title" onCancel={event => { event.preventDefault(); close(); }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/50">
    <h2 id="signature-title" className="text-xl font-semibold">电子签名</h2>
    <p className="mt-3 break-words text-sm leading-7">您正在签署任务：【{task.title}】，操作将变更为【已完成】</p>
    <form onSubmit={submit} aria-busy={busy} className="mt-5 space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <label className="block text-sm">实际工时<input aria-label="签名实际工时" required type="number" min="0.01" max="10000" step="0.01" value={hours} onChange={event => setHours(event.target.value)} className="mt-2 block w-full rounded-md border border-slate-300 p-2" /></label>
        <label className="block text-sm" htmlFor="signature-password">签名密码</label>
        <div className="relative"><input autoFocus id="signature-password" autoComplete="current-password" required type={visible ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} className="block w-full rounded-md border border-slate-300 p-2 pr-12" /><button type="button" aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible} onClick={() => setVisible(value => !value)} className="absolute right-2 top-2 border-0 p-0.5">{visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button></div>
        <label className="block text-sm">签名意图<select aria-label="签名意图" value={reason} onChange={event => setReason(event.target.value)} className="mt-2 block w-full rounded-md border border-slate-300 p-2">{SIGNATURE_REASONS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <p className="text-xs leading-5 text-slate-500">请选择与本次实际完成事项一致的签名意图，例如会议、培训或验收。</p>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={close} className="rounded-md border border-slate-300 px-4 py-2">取消</button><button disabled={busy} className="rounded-md bg-teal-800 px-4 py-2 text-white disabled:opacity-50">{busy ? "正在签署…" : "确认签署"}</button></div>
    </form><ToastViewport />
  </dialog>;
}
