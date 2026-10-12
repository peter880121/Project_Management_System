import type { Role } from "@prisma/client";

export type AuthenticatedUser = Readonly<{ id: string; role: Role }>;

/** Return an HTTP response for unauthenticated or unauthorized requests. */
export function requireRole(
  user: AuthenticatedUser | null,
  roles: readonly Role[],
): Response | null {
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!roles.includes(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return null;
}
