import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { findIssue } from "@/modules/audit/issue-repositories";
import { IssueDetail } from "@/components/audit/issue-detail";
export const dynamic = "force-dynamic";
export default async function IssuePage({ params }: { params: Promise<{ issueId: string }> }) {
  const actor = await getCurrentUser();
  if (requireRole(actor, ["ADMIN", "QA", "PM", "MEMBER"])) return <main className="p-8">请登录后查看整改问题。</main>;
  const { issueId } = await params;
  if (!z.uuid().safeParse(issueId).success || !await findIssue(actor!, issueId)) notFound();
  return <main className="mx-auto min-h-screen max-w-5xl space-y-5 px-6 py-10"><Link href="/audit/issues" className="text-sm text-teal-800 underline">返回整改跟踪</Link><IssueDetail id={issueId} role={actor!.role} userId={actor!.id} /></main>;
}
