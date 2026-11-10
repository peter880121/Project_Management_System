"use client";

import Link from "next/link";
import { ChartNoAxesCombined, ClipboardList, FolderKanban, Sparkles, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import { NavigationLogout } from "@/components/navigation-logout";
import { isActiveNavigation, sidebarItems, type LayoutUser } from "./navigation";
import type { Ref } from "react";

const icons = { home: Sparkles, dashboard: ChartNoAxesCombined, projects: FolderKanban, audit: ClipboardList, users: UsersRound, profile: UserRound };
export function AppSidebar({ user, pathname, open, onNavigate, onClose, panelRef }: { user: LayoutUser; pathname: string; open: boolean; onNavigate: () => void; onClose: () => void; panelRef: Ref<HTMLElement> }) {
  return <>
    {open && <button type="button" aria-label="关闭导航遮罩" onClick={onClose} className="fixed inset-0 z-40 rounded-none border-0 bg-slate-950/40 p-0 lg:hidden" />}
    <aside id="app-sidebar" ref={panelRef} aria-label="全局侧边栏" role={open ? "dialog" : undefined} aria-modal={open ? true : undefined} className={`fixed inset-y-0 left-0 z-50 w-[240px] flex-col border-r border-slate-200 bg-white ${open ? "flex" : "hidden lg:flex"}`}>
      <div className="flex h-24 shrink-0 items-center gap-3 px-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-800 text-white"><ShieldCheck aria-hidden="true" className="h-6 w-6" /></span>
        <div><p className="text-base font-semibold tracking-tight">MedPM-AI</p><p className="mt-1 text-xs text-slate-500">合规交付工作台</p></div>
        <button type="button" aria-label="关闭导航" onClick={onClose} className="ml-auto border-0 p-1 text-slate-500 lg:hidden"><X aria-hidden="true" className="h-5 w-5" /></button>
      </div>
      <nav aria-label="主导航" className="flex min-h-0 flex-1 flex-col px-4 pb-5">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-2">{sidebarItems(user.role).map(item => {
          const active = isActiveNavigation(item.href, pathname);
          const Icon = icons[item.icon as keyof typeof icons];
          return <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 py-3 text-sm font-medium transition-colors ${active ? "border-teal-100 bg-teal-50 text-teal-900" : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"}`}><Icon aria-hidden="true" className="h-5 w-5 shrink-0" /><span>{item.label}</span></Link>;
        })}</div>
        <div className="mt-auto shrink-0 border-t border-slate-200 pt-4">
          <p className="truncate px-3 text-sm font-medium" title={user.name}>{user.name}</p>
          <p className="mb-4 mt-1 px-3 text-xs text-slate-500">当前角色 · {user.role}</p>
          <NavigationLogout sidebar />
        </div>
      </nav>
    </aside>
  </>;
}
