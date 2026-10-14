import Link from "next/link";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { ReloadButton } from "@/components/reload-button";

export function AppNavigation({ user, unavailable = false }: { user: AuthenticatedUser | null; unavailable?: boolean }) {
  return <nav aria-label="主导航" className="flex flex-wrap items-center gap-5 border-b border-slate-200 pb-5 text-sm font-medium">
    <Link href="/" className="text-teal-800">MedPM-AI · 首页</Link>
    {unavailable ? <span role="status">登录状态暂时无法确认，<ReloadButton /></span>
      : user ? <Link href="/profile" className="text-teal-800">个人资料</Link>
        : <><Link href="/login" className="text-teal-800">登录</Link><Link href="/register" className="text-teal-800">注册账号</Link></>}
  </nav>;
}
