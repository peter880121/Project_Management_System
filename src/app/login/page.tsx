import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { getCurrentUser } from "@/modules/auth/session";
import { getSafeRedirect } from "@/modules/auth/redirect";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return <AuthCard title="暂时无法加载，请重试" description="暂时无法确认登录状态，请稍后重新加载。">
      <a href="/login" className="text-teal-800 underline">重新加载</a>
    </AuthCard>;
  }
  // redirect throws internally, so keep it outside the database error handler.
  if (user) redirect("/");

  const target = getSafeRedirect((await searchParams).next);
  const registerHref = target === "/" ? "/register" : `/register?next=${encodeURIComponent(target)}`;
  return <AuthCard title="登录" description="登录 MedPM-AI，继续你的合规交付工作。"
    footer={<Link href={registerHref} className="text-teal-800 underline">没有账号？注册账号</Link>}>
    <LoginForm target={target} />
  </AuthCard>;
}
