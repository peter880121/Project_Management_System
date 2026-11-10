"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Ellipsis, LayoutGrid, GanttChart, Files, NotebookPen, ClipboardList } from "lucide-react";
import { projectNavigationLinks } from "@/modules/projects/navigation";
const icons = { board: LayoutGrid, requirements: ClipboardList, planning: GanttChart, deliverables: Files, meetings: NotebookPen };
export function ProjectBoardNavigation({ projectId, role }: { projectId: string; role: string }) {
  const pathname = usePathname(); const [open, setOpen] = useState(false); const menuId = useId();
  const container = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null); const last = useRef(false);
  const links = projectNavigationLinks(projectId, role); const more = links.filter(link => !link.primary);
  const order = ["board", "requirements", "planning", "deliverables", "meetings"];
  const primary = links.filter(link => link.primary).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map(link => ({ ...link, Icon: icons[link.key as keyof typeof icons] ?? LayoutGrid }));
  function close(restore = false) { setOpen(false); if (restore) trigger.current?.focus(); }
  useEffect(() => { setOpen(false); }, [pathname]);
  useLayoutEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'); (last.current ? items?.[items.length - 1] : items?.[0])?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside); return () => { document.removeEventListener("pointerdown", outside); };
  }, [open]);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(true); return; }
    if (event.key === "Tab") {
      event.preventDefault();
      const outside = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length > 0 && !menu.current?.contains(element) && !element.closest("[inert]"));
      const index = outside.indexOf(trigger.current!); close(); (event.shiftKey ? trigger.current : outside[index + 1] ?? outside[0])?.focus(); return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const items = Array.from(menu.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? []); if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLAnchorElement);
    items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus();
  }
  return <nav aria-label="项目功能" className="mt-4 flex min-w-0 items-end gap-2 border-b border-slate-200">
    <div className="min-w-0 flex-1 overflow-x-auto"><div className="flex w-max gap-1">{primary.map(({ href, label, Icon }) => <Link key={href} href={href} onClick={event => { if (pathname === href) event.preventDefault(); }} aria-current={pathname === href ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-none border-0 border-b-2 px-3 py-3 text-xs font-medium transition sm:px-4 sm:text-sm ${pathname === href ? "border-b-teal-700 bg-teal-50/60 text-teal-900" : "border-b-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}><Icon aria-hidden="true" className="size-4 shrink-0" />{label}</Link>)}</div></div>
    <div ref={container} className="relative mb-1 shrink-0"><button ref={trigger} type="button" aria-label="更多项目功能" aria-haspopup="menu" aria-controls={open ? menuId : undefined} aria-expanded={open} onClick={() => { last.current = false; setOpen(value => !value); }} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); last.current = event.key === "ArrowUp"; setOpen(true); } if (event.key === "Escape") close(); }} className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border-0 px-3 py-2 text-xs font-medium sm:text-sm ${open || more.some(link => pathname === link.href) ? "bg-teal-50 text-teal-900" : "bg-transparent text-slate-500 hover:bg-slate-100"}`}><Ellipsis aria-hidden="true" className="size-4" />更多<ChevronDown aria-hidden="true" className="size-3" /></button>
      {open && <div ref={menu} id={menuId} role="menu" aria-label="更多项目功能" onKeyDown={keyboard} className="absolute right-0 top-full z-40 mt-2 max-h-[min(60vh,24rem)] w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10">{more.map(link => <Link key={link.href} href={link.href} role="menuitem" tabIndex={-1} onClick={() => close()} className="block rounded-lg border-0 px-3 py-2.5 text-sm text-slate-600 hover:bg-teal-50 hover:text-teal-900 focus:bg-teal-50">{link.label}</Link>)}</div>}
    </div>
  </nav>;
}
