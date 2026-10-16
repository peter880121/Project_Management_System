import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { TaskBoard } from "./task-board";
import { hasProjectAccess } from "@/modules/auth/project-access";

export const dynamic = "force-dynamic";

export default async function ProjectBoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return <main className="mx-auto max-w-5xl p-8"><h1 className="text-2xl font-semibold">请先登录查看看板</h1></main>;
  const { projectId } = await params;
  if (!await hasProjectAccess(user!, projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, requirements: { select: { id: true, title: true }, orderBy: { title: "asc" } } } });
  if (!project) notFound();
  return <><nav className="mx-auto flex max-w-7xl flex-wrap gap-5 px-6 pt-6"><Link className="text-teal-800 hover:underline" href={`/projects/${projectId}/planning`}>排期与人员容量 →</Link><Link className="text-teal-800 hover:underline" href={`/projects/${projectId}/traceability`}>维护需求与测试追溯 →</Link><Link className="text-teal-800 hover:underline" href={`/projects/${projectId}/documents`}>项目文档 →</Link><Link className="text-teal-800 hover:underline" href={`/projects/${projectId}/members`}>项目成员 →</Link>{["ADMIN", "QA"].includes(user!.role) && <Link className="text-teal-800 hover:underline" href={`/projects/${projectId}/exports`}>合规导出 →</Link>}</nav><TaskBoard project={{ id: project.id, name: project.name }} requirements={project.requirements} role={user!.role} userId={user!.id} /></>;
}
