import { PageBackLink } from "@/components/page-back-link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { PlanningPanel } from "./planning-panel";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";
export const dynamic = "force-dynamic";
export default async function PlanningPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ onboarding?: string }> }) {
  const user = await getCurrentUser(); if (requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"])) return <main className="p-8">请先登录查看甘特图。</main>;
  const { projectId } = await params; if (!z.uuid().safeParse(projectId).success) notFound();
  if (!await hasProjectAccess(user!, projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }); if (!project) notFound();
  if ((await searchParams).onboarding === "1") redirect(`/projects/${projectId}/board?onboarding=1`);
  return <main className="mx-auto max-w-6xl space-y-5 p-6 sm:p-8"><PageBreadcrumbs pathname={`/projects/${projectId}/planning`} items={projectBreadcrumbs({ id: projectId, name: project.name }, "甘特图")} /><PageBackLink href={`/projects/${projectId}/board`}>返回任务看板</PageBackLink><h1 className="text-3xl font-semibold">{project.name} · 甘特图</h1><p className="text-sm leading-7 text-slate-500">查看任务计划、阶段和依赖关系。任务安排与状态变更统一在任务管理中完成；成员周容量在项目成员页维护。</p><PlanningPanel projectId={projectId} /></main>;
}
