import type { ReactNode } from "react";
import { AppShell } from "./layout/app-shell";
import { getCurrentUser } from "@/modules/auth/session";
import { prisma } from "@/lib/prisma";

export async function AppHeader({ children }: { children: ReactNode }) {
  try {
    const user = await getCurrentUser();
    const identity = user ? await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } }) : null;
    return <AppShell user={user && identity ? { ...user, ...identity } : null}>{children}</AppShell>;
  } catch {
    return <AppShell user={null} unavailable>{children}</AppShell>;
  }
}
