import Link from "next/link";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { visibleProjectWhere } from "@/modules/auth/project-access";
import { prisma } from "@/lib/prisma";
import { IssuesWorkspace } from "@/components/audit/issues-workspace";
import { z } from "zod";
import { issueStates } from "@/modules/audit/issue-schema";
export const dynamic = "force-dynamic";
export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{
    projectId?: string;
    status?: string;
    overdue?: string;
  }>;
}) {
  const actor = await getCurrentUser();
  if (requireRole(actor, ["ADMIN", "QA", "PM", "MEMBER"]))
    return <main className="p-8">请登录后查看整改跟踪。</main>;
  const projects = await prisma.project.findMany({
    where: visibleProjectWhere(actor!),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const { projectId, status, overdue } = await searchParams;
  const selectedStatus = z.enum(issueStates).safeParse(status);
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <p className="text-sm text-teal-800">审计 / 整改跟踪</p>
      <h1 className="mt-3 text-3xl font-semibold">审计整改跟踪</h1>
      <p className="mt-3 text-slate-600">
        发现 → 复核 → 分派整改 → 提交证据 → QA 验证 →
        关闭。项目成员仅查看本人负责的问题。
      </p>
      {["ADMIN", "QA"].includes(actor!.role) && (
        <Link
          href="/audit"
          className="mt-4 inline-block text-sm text-teal-800 underline"
        >
          操作记录与合规检查
        </Link>
      )}
      <IssuesWorkspace
        projects={projects}
        canExport={["ADMIN", "QA"].includes(actor!.role)}
        initialStatus={selectedStatus.success ? selectedStatus.data : ""}
        initialOverdue={overdue === "true"}
        initialProjectId={
          z.uuid().safeParse(projectId).success &&
          projects.some((p) => p.id === projectId)
            ? projectId
            : ""
        }
      />
    </main>
  );
}
