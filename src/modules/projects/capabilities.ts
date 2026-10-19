import type { Role } from "@prisma/client";
export function projectCapabilities(project: { status: string; rowVersion: number; ownerId: string | null; archivedAt: Date | null; currentAcceptance?: { state: string; submittedById: string; qaApprovedById: string | null } | null }, actor: { id: string; role: Role }) {
  const writable = !["ARCHIVED", "PENDING_ACCEPTANCE"].includes(project.status);
  return { status: project.status, rowVersion: project.rowVersion, role: actor.role, archivedAt: project.archivedAt?.toISOString() ?? null, writable,
    canEditTasks: writable && ["PM", "ADMIN", "MEMBER"].includes(actor.role), canSchedule: writable && actor.role === "PM", canManageMembers: writable && (actor.role === "ADMIN" || actor.role === "PM" && project.ownerId === actor.id),
    canUploadDeliverables: writable && actor.role === "PM", canApproveDeliverables: writable && ["QA", "ADMIN"].includes(actor.role), canCreateMeeting: writable && actor.role === "PM",
    canActivate: actor.role === "PM" && ["PLANNING", "ON_HOLD", "COMPLETED"].includes(project.status), canSubmitAcceptance: actor.role === "PM" && project.status === "ACTIVE",
    canQaApprove: actor.role === "QA" && project.status === "PENDING_ACCEPTANCE" && project.currentAcceptance?.state === "SUBMITTED" && project.currentAcceptance.submittedById !== actor.id,
    canArchive: actor.role === "ADMIN" && project.status === "PENDING_ACCEPTANCE" && project.currentAcceptance?.state === "QA_APPROVED" && ![project.currentAcceptance.qaApprovedById, project.currentAcceptance.submittedById].includes(actor.id),
    canWithdraw: actor.role === "PM" && project.status === "PENDING_ACCEPTANCE", canReject: actor.role === "QA" && project.status === "PENDING_ACCEPTANCE" };
}
export type ProjectCapabilities = ReturnType<typeof projectCapabilities>;
