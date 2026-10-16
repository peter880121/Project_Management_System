import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { PlanningPanel } from "./planning-panel";
import { hasProjectAccess } from "@/modules/auth/project-access";
export const dynamic = "force-dynamic";
export default async function PlanningPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); if (requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"])) return <main className="p-8">请先登录查看排期。</main>;
  const { projectId } = await params; if (!z.uuid().safeParse(projectId).success) notFound();
  if (!await hasProjectAccess(user!, projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }); if (!project) notFound();
  return <main className="mx-auto max-w-6xl space-y-5 p-8"><Link className="back-link text-teal-800 underline" href={`/projects/${projectId}/board`}>← 返回看板</Link><h1 className="text-3xl font-semibold">{project.name} · 排期与人员容量</h1><p>PM 人工维护任务计划与成员容量；日期按 UTC 日历日，截止到当日结束。容量按周一至周日统计，预计工时在计划日期间按日历天均摊，计入跨项目任务。尚未配置容量不会被视作零工时。</p><PlanningPanel projectId={projectId} canManage={user!.role === "PM"} /></main>;
}
