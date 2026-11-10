import { AcceptanceCheckProvider } from "@/components/projects/acceptance-check-context";
import { notFound } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/modules/auth/session";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { projectCapabilities } from "@/modules/projects/capabilities";
import { ProjectCapabilitiesProvider } from "@/components/projects/capabilities-context";
export const dynamic = "force-dynamic";
export default async function Layout({ params, children }: { params: Promise<{ projectId: string }>; children: React.ReactNode }) {
  const { projectId } = await params; if (!z.uuid().safeParse(projectId).success) notFound();
  const actor = await getCurrentUser(); if (!actor || !await hasProjectAccess(actor, projectId)) notFound();
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { currentStatusChange: { include: { actor: { select: { name: true } } } }, currentAcceptance: { select: { state: true, submittedById: true, qaApprovedById: true, overrideGapCount: true } } } });
  const grant = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: actor.id } }, select: { active: true, canOverrideAcceptance: true } });
  return <ProjectCapabilitiesProvider projectId={projectId} initial={projectCapabilities(project, actor, !!(grant?.active && grant.canOverrideAcceptance))}><AcceptanceCheckProvider projectId={projectId} actorId={actor.id}>{children}</AcceptanceCheckProvider></ProjectCapabilitiesProvider>;
}
