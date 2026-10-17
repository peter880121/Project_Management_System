"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type Toast = { id: number; message: string; kind: "success" | "error"; expiresAt: number };
const ToastContext = createContext<{ toasts: Toast[]; notify: (message: string, kind?: Toast["kind"]) => void; dismiss: (id: number) => void; dialog: (delta: number) => void } | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialogs, setDialogs] = useState(0);
  const nextId = useRef(0);
  const dismiss = useCallback((id: number) => setToasts(items => items.filter(item => item.id !== id)), []);
  const dialog = useCallback((delta: number) => setDialogs(count => Math.max(0, count + delta)), []);
  const notify = useCallback((message: string, kind: Toast["kind"] = "success") => setToasts(items => [...items, { id: ++nextId.current, message, kind, expiresAt: Date.now() + (kind === "error" ? 8000 : 5000) }].slice(-3)), []);
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts(items => items.filter(item => item.expiresAt > Date.now())), Math.max(0, Math.min(...toasts.map(item => item.expiresAt)) - Date.now()));
    return () => clearTimeout(timer);
  }, [toasts]);
  return <ToastContext.Provider value={{ toasts, notify, dismiss, dialog }}>{children}{dialogs === 0 && <ToastViewport />}</ToastContext.Provider>;
}
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("ToastProvider is required");
  return context;
}
export function useDialogToasts() {
  const { dialog } = useToast();
  useEffect(() => { dialog(1); return () => dialog(-1); }, [dialog]);
}
export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  return <div aria-label="操作反馈" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-h-[40dvh] w-[calc(100%-2rem)] max-w-sm flex-col gap-2 overflow-y-auto">{toasts.map(toast => <div key={toast.id} role={toast.kind === "error" ? "alert" : "status"} className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 text-sm shadow-lg ${toast.kind === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
    {toast.kind === "error" ? <AlertCircle aria-hidden="true" className="size-5 shrink-0" /> : <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" />}<p className="flex-1">{toast.message}</p><button type="button" aria-label="关闭提示" className="border-0 p-0" onClick={() => dismiss(toast.id)}><X aria-hidden="true" className="size-4" /></button>
  </div>)}</div>;
}
