import { PageBackLink } from "@/components/page-back-link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { ProjectSettings } from "@/components/projects/project-settings";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { projectBreadcrumbs } from "@/components/layout/breadcrumbs";
export const dynamic = "force-dynamic";
export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const actor = await getCurrentUser();
  if (!actor || !await hasProjectAccess(actor, projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, description: true, ownerId: true, rowVersion: true, owner: { select: { name: true } } } });
  if (!project) notFound();
  const manager = actor.role === "ADMIN" || actor.role === "PM" && project.ownerId === actor.id;
  const candidates = manager ? await prisma.user.findMany({ where: { role: "PM", status: "ACTIVE", isSystem: false }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 }) : [];
  return <main className="mx-auto max-w-4xl space-y-6 p-6"><PageBreadcrumbs pathname={`/projects/${projectId}/settings`} items={projectBreadcrumbs(project, "项目设置")} /><PageBackLink href={`/projects/${projectId}/board`}>返回任务看板</PageBackLink><h1 className="text-2xl font-semibold">项目设置</h1><ProjectSettings key={`${project.rowVersion}:${actor.role}`} project={project} candidates={candidates.length > 1000 ? [] : candidates} directoryOverflow={candidates.length > 1000} /></main>;
}
