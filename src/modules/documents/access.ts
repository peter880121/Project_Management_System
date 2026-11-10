import { canReadRoles } from "@/modules/assets/validation";
export const meetingAttachmentSelect = { id: true, projectId: true, visibleRoles: true, status: true } as const;
export function canReadDocument(document: { projectId?: string; visibleRoles: unknown; meetingAttachment?: { projectId: string; visibleRoles: unknown; status: string } | null }, role: string) {
  if (!canReadRoles(document.visibleRoles, role)) return false;
  const meeting = document.meetingAttachment;
  return !meeting || (meeting.projectId === document.projectId && canReadRoles(meeting.visibleRoles, role) && (meeting.status !== "DRAFT" || ["PM", "ADMIN"].includes(role)));
}
