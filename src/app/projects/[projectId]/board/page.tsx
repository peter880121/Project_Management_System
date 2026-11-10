import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { TaskBoard } from "./task-board";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";
import { projectListReturnTo } from "@/modules/projects/list-query";

export const dynamic = "force-dynamic";

export default async function ProjectBoardPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ createdTask?: string; taskId?: string; tab?: string; onboarding?: string; returnTo?: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return <main className="mx-auto max-w-5xl p-8"><h1 className="text-2xl font-semibold">请先登录查看看板</h1></main>;
  const { projectId } = await params;
  if (!await hasProjectAccess(user!, projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, requirements: { select: { id: true, title: true }, orderBy: { title: "asc" } } } });
  if (!project) notFound();
  const query = await searchParams;
  const returnTo = projectListReturnTo(query.returnTo);
  const breadcrumbs = projectBreadcrumbs(project, "看板"); breadcrumbs[0] = { ...breadcrumbs[0], href: returnTo };
  return <><PageBreadcrumbs pathname={`/projects/${project.id}/board`} items={breadcrumbs} /><TaskBoard returnTo={returnTo} project={{ id: project.id, name: project.name }} role={user!.role} userId={user!.id} onboarding={query.onboarding === "1"} createdTaskId={query.createdTask} openTaskId={query.taskId} openDeliverables={query.tab === "deliverables"} /></>;
}
