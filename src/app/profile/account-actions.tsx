"use client";

import { PasswordForm } from "./password-form";
import { useAccountActionLock } from "@/components/account-action-lock";

export function AccountActions() {
  const { busy, acquire, release } = useAccountActionLock();
  return <div className="space-y-8">
    <section aria-labelledby="password-heading" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 id="password-heading" className="mb-5 text-xl font-semibold">修改密码</h2>
      <PasswordForm busy={busy} acquire={acquire} release={release} />
    </section>
    <section aria-labelledby="logout-heading" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 id="logout-heading" className="mb-2 text-xl font-semibold">登出账号</h2>
      <p className="mb-4 text-sm text-slate-600">登出当前设备，其他设备的登录不受影响。</p>
      <p className="text-sm text-slate-600">使用页面顶部主导航中的「登出」按钮。</p>
    </section>
  </div>;
}
