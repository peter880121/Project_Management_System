import { notFound, redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { PageBackLink } from "./page-back-link";
import { PageBreadcrumbs } from "./layout/page-breadcrumbs";
import { projectBreadcrumbs } from "./layout/breadcrumbs";

export async function ProjectWorkspace({ projectId, title, roles, children, breadcrumb }: { projectId: string; title: string; roles: Role[]; children: React.ReactNode; breadcrumb: { segment: "wbs" | "risks"; label: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/projects");
  if (!await hasProjectAccess(user, projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) notFound();
  return <main className="mx-auto max-w-6xl px-6 py-8"><PageBreadcrumbs pathname={`/projects/${projectId}/${breadcrumb.segment}`} items={projectBreadcrumbs({ id: projectId, name: project.name }, breadcrumb.label)} /><PageBackLink href={`/projects/${projectId}/board`}>← 返回任务看板</PageBackLink><p className="text-sm text-slate-500">{project.name}</p><h1 className="mt-2 text-3xl font-semibold">{title}</h1>{roles.includes(user.role) ? children : <p className="mt-6 rounded-lg border bg-white p-5">当前角色无权操作此功能，请使用 {roles.join(" / ")} 账号。</p>}</main>;
}
