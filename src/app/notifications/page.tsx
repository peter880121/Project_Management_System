import Link from "next/link";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { NotificationPanel } from "./notification-panel";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
export const dynamic = "force-dynamic";
export default async function NotificationsPage() {
  if (requireRole(await getCurrentUser(), ["PM"])) return <main className="p-8">请使用 PM 账号查看个人风险通知。</main>;
  return <main className="mx-auto max-w-4xl space-y-5 p-8"><PageBreadcrumbs pathname="/notifications" items={[{ label: "我的风险通知" }]} /><Link href="/projects" className="back-link text-teal-800 underline">← 返回项目</Link><h1 className="text-3xl font-semibold">我的风险通知</h1><p>仅展示发给当前账号的提醒。标为已读表示你看过通知，不等于风险已处理；请打开项目风险列表核对依据并处置。</p><NotificationPanel /></main>;
}
