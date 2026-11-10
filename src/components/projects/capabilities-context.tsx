"use client";
import { ProjectLifecycleControls } from "./lifecycle-controls";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast-provider";
import type { ProjectCapabilities } from "@/modules/projects/capabilities";
type Value = { capabilities: ProjectCapabilities | null; refresh: () => Promise<void>; freezeAfterTransition: (status: string, reason: string, rowVersion: number) => void; epoch: number };
const CapabilitiesContext = createContext<Value>({ capabilities: null, refresh: async () => {}, freezeAfterTransition: () => {}, epoch: 0 });
export const useProjectCapabilities = () => useContext(CapabilitiesContext);
export function ProjectCapabilitiesProvider({ projectId, initial, children }: { projectId: string; initial: ProjectCapabilities; children: ReactNode }) {
  const router = useRouter(); const { notify } = useToast(); const [caps, setCaps] = useState(initial); const [epoch, setEpoch] = useState(0);
  const refreshSequence = useRef(0); const current = useRef(initial); const originalFetch = useRef<typeof fetch | null>(null); const recovering = useRef<Promise<void> | null>(null); const alive = useRef(true);
  useEffect(() => { if (initial.rowVersion >= current.current.rowVersion && JSON.stringify(current.current) !== JSON.stringify(initial)) { refreshSequence.current += 1; current.current = initial; setCaps(initial); setEpoch(n => n + 1); } }, [initial]);
  const refresh = useCallback(async (announce = false) => {
    const sequence = ++refreshSequence.current;
    const response = await (originalFetch.current ?? window.fetch)(`/api/projects/${projectId}/lifecycle`, { cache: "no-store" });
    if (!alive.current || sequence !== refreshSequence.current) return;
    if (response.status === 401) { router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`); return; }
    if (!response.ok) { if (response.status === 403) { setCaps(c => ({ ...c, writable: false, canPause: false, canResume: false, canCancel: false, canActivate: false, canSubmitAcceptance: false, canQaApprove: false, canArchive: false, canWithdraw: false, canReject: false, canOverrideAcceptance: false, canRunAcceptanceCheck: false, canEditTasks: false, canSchedule: false, canManageMembers: false, canUploadDeliverables: false, canApproveDeliverables: false, canCreateMeeting: false })); router.refresh(); } throw new Error("项目状态刷新失败，请手动刷新"); }
    const next = (await response.json()).data.capabilities as ProjectCapabilities;
    if (!alive.current || sequence !== refreshSequence.current || next.rowVersion < current.current.rowVersion) return;
    const changed = JSON.stringify(current.current) !== JSON.stringify(next); current.current = next; setCaps(next);
    if (changed) { setEpoch(n => n + 1); if (announce) { notify(next.status === "ON_HOLD" ? "项目已暂停，页面已切换为只读" : next.status === "CANCELLED" ? "项目已取消，页面已切换为只读" : next.status === "PENDING_ACCEPTANCE" ? "项目已进入验收，页面已刷新" : "项目状态或权限已变更，页面已刷新", "error"); router.refresh(); } }
  }, [notify, projectId, router]);
  const recover = useCallback((status?: string) => {
    if (recovering.current) return recovering.current;
    refreshSequence.current += 1;
    // Clear unsaved component state immediately; stale requests cannot restore it.
    setCaps(c => ({ ...c, ...(["ARCHIVED", "ON_HOLD", "CANCELLED"].includes(status ?? "") ? { status: status! } : {}), writable: false, canPause: false, canResume: false, canCancel: false, canActivate: false, canSubmitAcceptance: false, canQaApprove: false, canArchive: false, canWithdraw: false, canReject: false, canOverrideAcceptance: false, canRunAcceptanceCheck: false, canEditTasks: false, canSchedule: false, canManageMembers: false, canUploadDeliverables: false, canApproveDeliverables: false, canCreateMeeting: false })); setEpoch(n => n + 1);
    notify(status === "ON_HOLD" ? "项目已暂停，页面已切换为只读" : status === "CANCELLED" ? "项目已取消，页面已切换为只读" : status === "PROJECT_FROZEN" ? "项目已暂停或取消，页面已切换为只读" : "该项目已被归档/权限已变更，页面已刷新", "error");
    recovering.current = refresh().catch(() => {}).finally(() => { recovering.current = null; if (alive.current) router.refresh(); }); return recovering.current;
  }, [notify, refresh, router]);
  useEffect(() => {
    alive.current = true; const previous = window.fetch; originalFetch.current = previous;
    // Observe project requests centrally while preserving native Response objects and aborts.
    const wrapped: typeof fetch = async (input, init) => {
      const response = await previous(input, init); const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      const belongs = url.origin === window.location.origin && (url.pathname === `/api/projects/${projectId}` || url.pathname.startsWith(`/api/projects/${projectId}/`) || /^\/api\/(tasks|documents|deliverables|meetings|ai|risk-jobs)\//.test(url.pathname) || /\/api\/users\/[^/]+\/capacity$/.test(url.pathname));
      if (belongs && response.status === 403 && alive.current) { const body = await response.clone().json().catch(() => null); void recover(body?.projectStatus ?? (body?.code === "PROJECT_ARCHIVED" ? "ARCHIVED" : body?.code)); }
      return response;
    };
    window.fetch = wrapped;
    const focus = () => { void refresh(true).catch(() => {}); };
    const invalidated = (event: Event) => { void recover(event instanceof CustomEvent ? event.detail?.projectStatus ?? (event.detail?.code === "PROJECT_ARCHIVED" ? "ARCHIVED" : event.detail?.code) : undefined); };
    window.addEventListener("focus", focus); window.addEventListener("project-access-invalidated", invalidated);
    const interval = setInterval(() => { if (document.visibilityState === "visible") focus(); }, 15000);
    return () => { alive.current = false; clearInterval(interval); window.removeEventListener("focus", focus); window.removeEventListener("project-access-invalidated", invalidated); if (window.fetch === wrapped) window.fetch = previous; };
  }, [projectId, recover, refresh]);
  const freezeAfterTransition = useCallback((status: string, reason: string, rowVersion: number) => {
    refreshSequence.current += 1;
    const next = { ...current.current, status, rowVersion, lifecycleReason: reason, writable: false, canPause: false, canResume: false, canCancel: false, canActivate: false, canSubmitAcceptance: false, canQaApprove: false, canArchive: false, canWithdraw: false, canReject: false, canOverrideAcceptance: false, canRunAcceptanceCheck: false, canEditTasks: false, canSchedule: false, canManageMembers: false, canUploadDeliverables: false, canApproveDeliverables: false, canCreateMeeting: false };
    current.current = next; setCaps(next); setEpoch(n => n + 1);
  }, []);
  return <CapabilitiesContext.Provider value={{ capabilities: caps, refresh, freezeAfterTransition, epoch }}><div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
    {["ON_HOLD", "CANCELLED"].includes(caps.status) && <div role="status" className={`shrink-0 border-b px-6 py-4 text-sm ${caps.status === "ON_HOLD" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-red-200 bg-red-50 text-red-900"}`}><strong className="mr-3">{caps.status === "ON_HOLD" ? "⏸ 项目已暂停 · 业务资料已冻结" : "⛔ 项目已取消 · 永久只读"}</strong><p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-words">{caps.lifecycleReason ?? (caps.status === "ON_HOLD" ? "历史暂停，原因未记录" : "历史取消，原因未记录")}</p>{caps.statusChangedAt && <p className="mt-1 text-xs opacity-75">{caps.statusChangedByName ?? "项目管理人员"} · {new Date(caps.statusChangedAt).toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong" })}</p>}</div>}
    {caps.status === "ARCHIVED" ? <div role="status" className="border-b border-slate-300 bg-slate-100 px-6 py-3 text-sm text-slate-800"><strong className="mr-3 rounded bg-slate-800 px-2 py-1 text-xs text-white">已归档</strong>项目业务资料已冻结，只允许查看和授权导出。{caps.archivedAt && <span className="ml-3 text-xs">归档时间：{new Date(caps.archivedAt).toLocaleString()}</span>}<Link href={`/projects/${projectId}/acceptance`} className="ml-4 text-teal-800 underline">验收与结项报告</Link></div> : caps.status === "PENDING_ACCEPTANCE" ? <div role="status" className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900"><strong>{caps.overrideGapCount > 0 ? `⚠️ 带风险待审（存在 ${caps.overrideGapCount} 个合规缺口）` : "待验收"}</strong> · 业务资料已锁定。需整改时请先撤回或驳回验收。<Link href={`/projects/${projectId}/acceptance`} className="ml-4 underline">查看验收进度</Link></div> : null}
    <ProjectLifecycleControls projectId={projectId} />
    <div className="min-h-0 flex-1 overflow-auto" key={`${projectId}:${epoch}`} data-project-readonly={!caps.writable}>{children}</div>
  </div></CapabilitiesContext.Provider>;
}
