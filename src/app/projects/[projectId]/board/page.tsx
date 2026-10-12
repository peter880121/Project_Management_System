import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { requireRole } from "@/modules/auth/rbac";
import { TaskBoard } from "./task-board";

export const dynamic = "force-dynamic";

export default async function ProjectBoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  const denied = requireRole(user, ["ADMIN", "PM", "MEMBER", "QA"]);
  if (denied) return <main className="mx-auto max-w-5xl p-8"><h1 className="text-2xl font-semibold">请先登录查看看板</h1></main>;
  const { projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, requirements: { select: { id: true, title: true }, orderBy: { title: "asc" } } } });
  if (!project) notFound();
  return <TaskBoard project={{ id: project.id, name: project.name }} requirements={project.requirements} role={user!.role} userId={user!.id} />;
}
