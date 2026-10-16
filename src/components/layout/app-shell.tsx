"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppTopbar } from "./app-topbar";
import { AppSidebar } from "./app-sidebar";
import { isProtectedPage, type LayoutUser } from "./navigation";
import { LayoutFailureContext, LayoutUnavailable } from "./layout-failure";

export function AppShell({ user, unavailable = false, children }: { user: LayoutUser | null; unavailable?: boolean; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [routeFailed, setRouteFailed] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const restoreNavigationFocus = useRef(false);
  const authPage = pathname === "/login" || pathname === "/register";
  const redirecting = !user && !unavailable && !routeFailed && isProtectedPage(pathname);
  const showSidebar = !!user && !authPage && !unavailable && !routeFailed;

  const close = useCallback((restoreFocus = false) => {
    restoreNavigationFocus.current = restoreFocus;
    setOpen(false);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const collapse = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", collapse);
    return () => desktop.removeEventListener("change", collapse);
  }, []);
  useEffect(() => {
    if (redirecting) router.replace(`/login?next=${encodeURIComponent(pathname + window.location.search)}`);
  }, [redirecting, pathname, router]);
  useEffect(() => {
    if (!open || !showSidebar) {
      // The topbar trigger lives inside the inert background: restore only after cleanup unlocks it.
      if (restoreNavigationFocus.current && document.hasFocus()) trigger.current?.focus();
      restoreNavigationFocus.current = false;
      return;
    }
    const priorOverflow = document.body.style.overflow;
    const bodyContent = content.current;
    const priorInert = bodyContent?.inert ?? false;
    if (bodyContent) bodyContent.inert = true;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
      if (event.key !== "Tab") return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? []).filter(element => element.getClientRects().length > 0);
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = priorOverflow; if (bodyContent) bodyContent.inert = priorInert; document.removeEventListener("keydown", keyboard); };
  }, [open, showSidebar, close]);

  return <LayoutFailureContext.Provider value={{ failed: routeFailed, setFailed: setRouteFailed }}>
    {unavailable ? <LayoutUnavailable /> : redirecting ? <p role="status" className="p-8 text-slate-600">正在前往登录页…</p> : <>
      {showSidebar && <AppSidebar user={user!} pathname={pathname} open={open} onNavigate={() => close()} onClose={() => close(true)} panelRef={panel} />}
      {!user && !routeFailed && <nav aria-label="主导航" className="mx-auto flex max-w-7xl flex-wrap gap-3 px-6 py-6"><Link href="/">首页</Link><Link href="/login">登录</Link><Link href="/register">注册账号</Link></nav>}
      <div id="app-content" ref={content} className={showSidebar ? "min-h-screen min-w-0 pt-14 lg:pl-[240px]" : "min-h-screen min-w-0"}>
        {showSidebar && <AppTopbar key={pathname} user={user!} openNavigation={() => setOpen(true)} navigationOpen={open} navigationTrigger={trigger} />}
        {children}
      </div>
    </>}
  </LayoutFailureContext.Provider>;
}
