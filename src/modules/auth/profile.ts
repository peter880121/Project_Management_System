import type { Role, UserStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type UserProfile = Readonly<{
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  lastLoginAt: Date | null;
}>;

/** Server-side lookup only. Callers must authenticate and supply the verified user's ID. */
export async function getProfileForUser(userId: string): Promise<UserProfile | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, status: true, lastLoginAt: true },
  });
}
