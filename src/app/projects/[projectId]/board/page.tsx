import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { TaskBoard } from "./task-board";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";

export const dynamic = "force-dynamic";

export default async function ProjectBoardPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ createdTask?: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return <main className="mx-auto max-w-5xl p-8"><h1 className="text-2xl font-semibold">请先登录查看看板</h1></main>;
  const { projectId } = await params;
  if (!await hasProjectAccess(user!, projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, requirements: { select: { id: true, title: true }, orderBy: { title: "asc" } } } });
  if (!project) notFound();
  const query = await searchParams;
  return <><PageBreadcrumbs pathname={`/projects/${project.id}/board`} items={projectBreadcrumbs(project, "看板")} /><TaskBoard project={{ id: project.id, name: project.name }} role={user!.role} userId={user!.id} createdTaskId={query.createdTask} /></>;
}
