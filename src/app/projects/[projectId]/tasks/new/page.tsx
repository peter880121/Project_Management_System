import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { prisma } from "@/lib/prisma";
import { PageBackLink } from "@/components/page-back-link";
import { CreateTaskForm } from "./task-form";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";

export const dynamic = "force-dynamic";
export default async function NewTaskPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ requirementId?: string }> }) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/projects/${projectId}/tasks/new`);
  if (!await hasProjectAccess(user, projectId)) notFound();
  if (!["PM", "ADMIN"].includes(user.role)) return <main className="p-8"><PageBackLink href={`/projects/${projectId}/board`}>← 返回任务看板</PageBackLink><h1>当前角色不能创建任务</h1></main>;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, requirements: { where: { OR: [{ managed: false }, { workflowState: { in: ["DRAFT", "APPROVED", "IMPLEMENTING"] } }] }, select: { id: true, title: true }, orderBy: { title: "asc" } } } });
  if (!project) notFound();
  const selectedRequirementId = (await searchParams).requirementId;
  return <main className="mx-auto max-w-3xl px-6 py-8"><PageBreadcrumbs pathname={`/projects/${projectId}/tasks/new`} items={[...projectBreadcrumbs({ id: projectId, name: project.name }, "看板").slice(0, 2), { label: "看板", href: `/projects/${projectId}/board` }, { label: "创建任务" }]} /><PageBackLink href={`/projects/${projectId}/board`}>← 返回任务看板</PageBackLink><h1 className="text-3xl font-semibold">创建任务</h1><p className="mt-3 text-slate-600">{project.name} · 创建后回到看板查看状态，再分配负责人。</p><CreateTaskForm projectId={projectId} requirements={project.requirements} selectedRequirementId={project.requirements.some(r => r.id === selectedRequirementId) ? selectedRequirementId : undefined} /></main>;
}
