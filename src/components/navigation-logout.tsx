"use client";

import { LogoutButton } from "@/app/profile/logout-button";
import { useAccountActionLock } from "./account-action-lock";
import { LogOut } from "lucide-react";

export function NavigationLogout({ sidebar = false, menuItem = false }: { sidebar?: boolean; menuItem?: boolean }) {
  const lock = useAccountActionLock();
  return <LogoutButton {...lock} menuItem={menuItem} icon={sidebar ? <LogOut aria-hidden="true" className="h-5 w-5 shrink-0" /> : undefined} className={sidebar || menuItem ? "w-full justify-start gap-3 border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50" : undefined} />;
}
