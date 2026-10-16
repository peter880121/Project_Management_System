"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/auth/form-message";

export function LogoutButton({ busy, acquire, release, icon, className, menuItem = false }: { busy: boolean; acquire: () => boolean; release: () => void; icon?: ReactNode; className?: string; menuItem?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const messageRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) messageRef.current?.focus(); }, [error]);
  async function logout() {
    if (!acquire()) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (response.ok) { window.location.replace("/login"); return; }
      setError("登出失败，请重试");
    } catch { setError("无法确认登出结果，请检查网络后重试"); }
    setPending(false);
    release();
  }
  return <div className="space-y-4">
    {error && <FormMessage ref={messageRef} message={error} />}
    <Button type="button" role={menuItem ? "menuitem" : undefined} tabIndex={menuItem ? -1 : undefined} variant="outline" className={className} disabled={busy} aria-busy={pending} onClick={logout}>{icon}{pending ? "登出中…" : "登出"}</Button>
  </div>;
}
