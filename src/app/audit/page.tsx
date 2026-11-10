import { PageBackLink } from "@/components/page-back-link";
import Link from "next/link";
import AuditLogViewer from "./viewer";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { prisma } from "@/lib/prisma";
import { visibleProjectWhere } from "@/modules/auth/project-access";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";

export const metadata = { title: "审计日志 · MedPM-AI" };

export default async function AuditPage() {
  const actor = await getCurrentUser();
  if (requireRole(actor, ["ADMIN", "QA"])) return <main className="p-8">仅 ADMIN 和 QA 可查看合规审计。</main>;
  const projects = await prisma.project.findMany({ where: visibleProjectWhere(actor!), select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <PageBreadcrumbs pathname="/audit" items={[{ label: "审计" }]} />
      <PageBackLink href="/">返回工作台</PageBackLink>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">审计日志与合规审查</h1>
      <nav className="mt-5 flex gap-4 text-sm"><span className="rounded-full bg-teal-50 px-4 py-2 text-teal-900">操作记录与合规检查</span><Link className="rounded-full border px-4 py-2 text-teal-800" href="/audit/issues">整改跟踪 →</Link></nav>
      <p className="mt-2 max-w-3xl text-slate-600">
        仅 ADMIN 和 QA 可以查询。日志采用追加写入；按项目、操作人、操作类型和时间范围筛选。
      </p>
      <p className="mt-3 text-slate-600">查询日志查看历史操作；选择项目后生成合规摘要，检查需求、任务与测试链路。摘要为辅助审查结果，不代表合规批准。</p>
      <AuditLogViewer projects={projects} canReview={actor!.role === "QA"} />
    </main>
  );
}
