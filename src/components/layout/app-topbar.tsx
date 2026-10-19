"use client";

import Link from "next/link";
import { ProjectNotifications } from "@/components/projects/project-notifications";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { ChevronDown, ChevronRight, Menu, UserRound } from "lucide-react";
import { useBreadcrumbs } from "./breadcrumb-context";
import type { LayoutUser } from "./navigation";
import { NavigationLogout } from "../navigation-logout";

export function AppTopbar({ user, openNavigation, navigationOpen, navigationTrigger }: { user: LayoutUser; openNavigation: () => void; navigationOpen: boolean; navigationTrigger: RefObject<HTMLButtonElement | null> }) {
  const { items } = useBreadcrumbs();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  function close(restore = true) {
    setOpen(false);
    if (restore && document.hasFocus()) trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function outside(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
        if (document.hasFocus()) trigger.current?.focus();
      }
    }
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [open]);
  function keyboard(event: KeyboardEvent) {
    const entries = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length;
      entries[next]?.focus();
    }
    if (event.key === "Tab") {
      // Let Tab leave the menu; restoring the trigger unconditionally would trap keyboard users.
      event.preventDefault();
      const outside = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length > 0 && !menu.current?.contains(element) && !element.closest("[inert]"));
      const current = outside.indexOf(trigger.current!);
      close(false);
      (event.shiftKey ? trigger.current : outside[current + 1] ?? outside[0])?.focus();
    }
  }
  return <header aria-label="顶部栏" className="fixed inset-x-0 top-0 z-40 flex h-14 min-w-0 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:left-[240px] lg:px-6">
    <button ref={navigationTrigger} type="button" aria-label="打开导航" aria-controls="app-sidebar" aria-expanded={navigationOpen} onClick={openNavigation} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-teal-800 lg:hidden"><Menu aria-hidden="true" className="h-5 w-5" /></button>
    <div className="min-w-0 flex-1 overflow-x-auto">
      {items.length > 0 && <nav aria-label="面包屑"><ol className="flex w-max items-center gap-2 text-sm text-slate-600">{items.map((item, index) => <li key={index} className="flex items-center gap-2">{index > 0 && <ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-400" />}{item.href && index < items.length - 1 ? <Link href={item.href} className="rounded hover:text-teal-800 hover:underline">{item.label}</Link> : <span aria-current={index === items.length - 1 ? "page" : undefined} className={index === items.length - 1 ? "font-medium text-slate-900" : undefined}>{item.label}</span>}</li>)}</ol></nav>}
    </div>
    <ProjectNotifications />
    <div ref={container} className="relative shrink-0">
      <button ref={trigger} type="button" aria-label="用户菜单" aria-haspopup="menu" aria-controls="app-user-menu" aria-expanded={open} onClick={() => open ? close() : setOpen(true)} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }} className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-2 text-slate-700 hover:bg-slate-50"><span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-50 text-teal-800">{user.name.trim().slice(0, 1) || <UserRound className="h-4 w-4" />}</span><ChevronDown aria-hidden="true" className="h-4 w-4" /></button>
      {open && <div ref={menu} id="app-user-menu" role="menu" aria-label="用户菜单" onKeyDown={keyboard} className="absolute right-0 top-11 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
        <div role="presentation" className="mb-2 border-b border-slate-100 px-3 py-2"><p className="break-all text-sm font-medium">{user.email}</p><p className="mt-1 text-xs text-slate-500">{user.role}</p></div>
        <Link href="/profile" role="menuitem" tabIndex={-1} onClick={() => close()} className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus:bg-teal-50">个人资料</Link>
        <NavigationLogout menuItem />
      </div>}
    </div>
  </header>;
}
