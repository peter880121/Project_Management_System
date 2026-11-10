"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { checkResultSchema, STALE_CHECK_MESSAGE, type CheckResult } from "@/modules/projects/acceptance-check/types";
type Value = { check: CheckResult | null; remember: (check: CheckResult | null) => void; expire: () => void };
const Context = createContext<Value>({ check: null, remember: () => {}, expire: () => {} });
export const useAcceptanceCheck = () => useContext(Context);
export function AcceptanceCheckProvider({ projectId, actorId, children }: { projectId: string; actorId: string; children: ReactNode }) {
  const key = `acceptance-check:${actorId}:${projectId}`; const [check, setCheck] = useState<CheckResult | null>(null); const [expired, setExpired] = useState(false); const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { try { const parsed = checkResultSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null")); if (parsed.success) setCheck(parsed.data); } catch { sessionStorage.removeItem(key); } }, [key]);
  const remember = useCallback((value: CheckResult | null) => { setCheck(value); try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* Storage may be disabled; server freshness checks remain mandatory. */ } }, [key]);
  const expire = useCallback(() => { remember(null); setExpired(true); }, [remember]);
  useEffect(() => { const element = dialog.current; if (expired) element?.showModal(); return () => element?.close(); }, [expired]);
  return <Context.Provider value={{ check, remember, expire }}>{children}{expired && <dialog ref={dialog} aria-label="体检结果已失效" onCancel={() => setExpired(false)} className="m-auto w-[min(92vw,480px)] rounded-2xl border-0 bg-white p-6 shadow-2xl backdrop:bg-slate-950/40"><h2 className="text-lg font-semibold text-amber-900">需要重新体检</h2><p className="mt-4 text-sm leading-7 text-slate-700">{STALE_CHECK_MESSAGE}</p><div className="mt-6 flex justify-end gap-3"><button onClick={() => setExpired(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">关闭</button><button onClick={() => { setExpired(false); window.dispatchEvent(new Event("acceptance-recheck")); }} className="rounded-lg bg-teal-800 px-4 py-2 text-sm text-white">重新体检</button></div></dialog>}</Context.Provider>;
}
