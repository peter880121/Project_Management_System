"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast-provider";
import type { ProjectCapabilities } from "@/modules/projects/capabilities";
type Value = { capabilities: ProjectCapabilities | null; refresh: () => Promise<void>; epoch: number };
const CapabilitiesContext = createContext<Value>({ capabilities: null, refresh: async () => {}, epoch: 0 });
export const useProjectCapabilities = () => useContext(CapabilitiesContext);
export function ProjectCapabilitiesProvider({ projectId, initial, children }: { projectId: string; initial: ProjectCapabilities; children: ReactNode }) {
  const router = useRouter(); const { notify } = useToast(); const [caps, setCaps] = useState(initial); const [epoch, setEpoch] = useState(0);
  const current = useRef(initial); const originalFetch = useRef<typeof fetch | null>(null); const recovering = useRef<Promise<void> | null>(null); const alive = useRef(true);
  useEffect(() => { if (JSON.stringify(current.current) !== JSON.stringify(initial)) { current.current = initial; setCaps(initial); setEpoch(n => n + 1); } }, [initial]);
  const refresh = useCallback(async (announce = false) => {
    const response = await (originalFetch.current ?? window.fetch)(`/api/projects/${projectId}/lifecycle`, { cache: "no-store" });
    if (!alive.current) return;
    if (response.status === 401) { router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`); return; }
    if (!response.ok) { if (response.status === 403) { setCaps(c => ({ ...c, writable: false, canEditTasks: false, canSchedule: false, canManageMembers: false, canUploadDeliverables: false, canApproveDeliverables: false, canCreateMeeting: false })); router.refresh(); } return; }
    const next = (await response.json()).data.capabilities as ProjectCapabilities;
    const changed = JSON.stringify(current.current) !== JSON.stringify(next); current.current = next; setCaps(next);
    if (changed) { setEpoch(n => n + 1); if (announce) { notify(next.status === "PENDING_ACCEPTANCE" ? "项目已进入验收，页面已刷新" : "该项目已被归档/权限已变更，页面已刷新", "error"); router.refresh(); } }
  }, [notify, projectId, router]);
  const recover = useCallback((archived = false) => {
    if (recovering.current) return recovering.current;
    // Clear unsaved component state immediately; stale requests cannot restore it.
    setCaps(c => ({ ...c, ...(archived ? { status: "ARCHIVED" } : {}), writable: false, canEditTasks: false, canSchedule: false, canManageMembers: false, canUploadDeliverables: false, canApproveDeliverables: false, canCreateMeeting: false })); setEpoch(n => n + 1);
    notify("该项目已被归档/权限已变更，页面已刷新", "error");
    recovering.current = refresh().catch(() => {}).finally(() => { recovering.current = null; if (alive.current) router.refresh(); }); return recovering.current;
  }, [notify, refresh, router]);
  useEffect(() => {
    alive.current = true; const previous = window.fetch; originalFetch.current = previous;
    // Observe project requests centrally while preserving native Response objects and aborts.
    const wrapped: typeof fetch = async (input, init) => {
      const response = await previous(input, init); const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      const belongs = url.origin === window.location.origin && (url.pathname.startsWith(`/api/projects/${projectId}/`) || /^\/api\/(tasks|documents|deliverables|meetings|ai|risk-jobs)\//.test(url.pathname) || /\/api\/users\/[^/]+\/capacity$/.test(url.pathname));
      if (belongs && response.status === 403 && alive.current) { const body = await response.clone().json().catch(() => null); void recover(body?.code === "PROJECT_ARCHIVED"); }
      return response;
    };
    window.fetch = wrapped;
    const focus = () => { void refresh(true).catch(() => {}); };
    const invalidated = (event: Event) => { void recover(event instanceof CustomEvent && event.detail?.code === "PROJECT_ARCHIVED"); };
    window.addEventListener("focus", focus); window.addEventListener("project-access-invalidated", invalidated);
    const interval = setInterval(() => { if (document.visibilityState === "visible") focus(); }, 15000);
    return () => { alive.current = false; clearInterval(interval); window.removeEventListener("focus", focus); window.removeEventListener("project-access-invalidated", invalidated); if (window.fetch === wrapped) window.fetch = previous; };
  }, [projectId, recover, refresh]);
  return <CapabilitiesContext.Provider value={{ capabilities: caps, refresh, epoch }}>
    {caps.status === "ARCHIVED" ? <div role="status" className="border-b border-slate-300 bg-slate-100 px-6 py-3 text-sm text-slate-800"><strong className="mr-3 rounded bg-slate-800 px-2 py-1 text-xs text-white">已归档</strong>项目业务资料已冻结，只允许查看和授权导出。{caps.archivedAt && <span className="ml-3 text-xs">归档时间：{new Date(caps.archivedAt).toLocaleString()}</span>}<Link href={`/projects/${projectId}/acceptance`} className="ml-4 text-teal-800 underline">验收与结项报告</Link></div> : caps.status === "PENDING_ACCEPTANCE" ? <div role="status" className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900"><strong>待验收</strong> · 业务资料已锁定。需整改时请先撤回或驳回验收。<Link href={`/projects/${projectId}/acceptance`} className="ml-4 underline">查看验收进度</Link></div> : null}
    <div key={`${projectId}:${epoch}`} data-project-readonly={!caps.writable}>{children}</div>
  </CapabilitiesContext.Provider>;
}
