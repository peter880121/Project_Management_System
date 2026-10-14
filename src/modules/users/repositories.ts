import { prisma } from "@/lib/prisma";

export async function listUserOptions() {
  // email distinguishes users with the same name; it is internal semi-public information.
  return prisma.user.findMany({
    where: { isSystem: false, status: "ACTIVE" },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}
