"use client";

import { useRef, useState } from "react";
import { PasswordForm } from "./password-form";
import { LogoutButton } from "./logout-button";

export function AccountActions() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  function acquire() {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    return true;
  }
  function release() { lock.current = false; setBusy(false); }
  return <div className="space-y-8">
    <section aria-labelledby="password-heading" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 id="password-heading" className="mb-5 text-xl font-semibold">修改密码</h2>
      <PasswordForm busy={busy} acquire={acquire} release={release} />
    </section>
    <section aria-labelledby="logout-heading" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 id="logout-heading" className="mb-2 text-xl font-semibold">登出账号</h2>
      <p className="mb-4 text-sm text-slate-600">登出当前设备，其他设备的登录不受影响。</p>
      <LogoutButton busy={busy} acquire={acquire} release={release} />
    </section>
  </div>;
}
