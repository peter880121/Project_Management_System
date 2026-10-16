import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { getCurrentSession } from "@/modules/auth/session";
import { getProfileForUser, type UserProfile } from "@/modules/auth/profile";
import { AccountActions } from "./account-actions";
import { LayoutFailureNotice } from "@/components/layout/layout-failure";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  let profile: UserProfile | null = null;
  try {
    const session = await getCurrentSession();
    if (session) profile = await getProfileForUser(session.userId);
  } catch {
    return <LayoutFailureNotice><AuthCard title="暂时无法加载，请重试" description="暂时无法确认登录状态或读取个人资料，请稍后重新加载。">
      <a href="/profile" className="text-teal-800 underline">重新加载</a>
    </AuthCard></LayoutFailureNotice>;
  }
  // A redirect is a framework control-flow exception, never a database failure.
  if (!profile || profile.status !== "ACTIVE") redirect("/login?next=/profile");

  const details = [
    ["姓名", profile.name], ["邮箱", profile.email], ["角色", profile.role],
    ["账号状态", "已激活（ACTIVE）"],
    ["最后登录时间（UTC）", profile.lastLoginAt ? profile.lastLoginAt.toISOString().replace("T", " ").replace("Z", " UTC") : "暂无记录"],
  ];
  return <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">

    <h1 className="mb-6 mt-8 text-3xl font-semibold">个人资料</h1>
    <section aria-label="当前用户信息" className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <dl className="space-y-4">{details.map(([label, value]) => <div key={label} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
        <dt className="text-sm text-slate-600">{label}</dt><dd className="break-words text-sm font-medium">{value}</dd>
      </div>)}</dl>
    </section>
    <AccountActions />
  </main>;
}
