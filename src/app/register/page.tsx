import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { getCurrentUser } from "@/modules/auth/session";
import { getSafeRedirect } from "@/modules/auth/redirect";
import { RegisterForm } from "./register-form";
import { LayoutFailureNotice } from "@/components/layout/layout-failure";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return <LayoutFailureNotice><AuthCard title="暂时无法加载，请重试" description="暂时无法确认登录状态，请稍后重新加载。">
      <a href="/register" className="text-teal-800 underline">重新加载</a>
    </AuthCard></LayoutFailureNotice>;
  }
  if (user) redirect("/");

  const target = getSafeRedirect((await searchParams).next);
  const loginHref = target === "/" ? "/login" : `/login?next=${encodeURIComponent(target)}`;
  return <AuthCard title="注册账号" description="仅使用合成信息。没有邀请码也可注册，账号需等待管理员激活。"
    footer={<Link href={loginHref} className="text-teal-800 underline">已有账号？去登录</Link>}>
    <RegisterForm loginHref={loginHref} />
  </AuthCard>;
}
