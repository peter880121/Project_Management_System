"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export function RiskNotificationLink() {
  const [unread, setUnread] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); let active = true;
    async function refresh() {
      if (document.visibilityState === "hidden") return;
      try { const response = await fetch("/api/notifications?page=1", { signal: abort.signal, cache: "no-store" }); if (!response.ok) throw new Error("Notification fetch failed"); const data = await response.json(); if (active && typeof data.unreadCount === "number") { setUnread(data.unreadCount); setUnavailable(false); } }
      catch { if (active) setUnavailable(true); }
    }
    const onFocus = () => { void refresh(); }; void refresh();
    const timer = setInterval(onFocus, 60000); window.addEventListener("focus", onFocus);
    return () => { active = false; abort.abort(); clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);
  return <Link href="/notifications" className="text-teal-800 underline">风险通知{unavailable ? "（暂不可用）" : unread !== null && unread > 0 ? `（${unread} 未读）` : ""}</Link>;
}
