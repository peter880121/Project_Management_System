import { prisma } from "@/lib/prisma";
import { Prisma, type Role, type UserStatus } from "@prisma/client";
import type { ListUsersQuery } from "./schemas";
export { lockUsers } from "@/modules/auth/transaction-locks";

const safeUserSelect = { id: true, name: true, email: true, role: true, status: true, lastLoginAt: true, createdAt: true } satisfies Prisma.UserSelect;
export type UserListItem = { id: string; name: string; email: string; role: Role; status: UserStatus; lastLoginAt: string | null; createdAt: string };
export type UserListResult = { data: UserListItem[]; total: number; page: number; pageSize: number };

export async function listManagedUsers(query: ListUsersQuery): Promise<UserListResult> {
  const where: Prisma.UserWhereInput = {
    isSystem: false, ...(query.role ? { role: query.role } : {}), ...(query.status ? { status: query.status } : {}),
    ...(query.keyword ? { OR: [{ name: { contains: query.keyword } }, { email: { contains: query.keyword } }] } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({ where, select: safeUserSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.user.count({ where }),
  ]);
  return { data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), lastLoginAt: row.lastLoginAt?.toISOString() ?? null })), total, page: query.page, pageSize: query.pageSize };
}

export function findManagementIdentity(tx: Prisma.TransactionClient, id: string) {
  return tx.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, isSystem: true } });
}
export function createManagedUser(tx: Prisma.TransactionClient, input: { name: string; email: string; role: Role; passwordHash: string }) {
  return tx.user.create({ data: { ...input, status: "ACTIVE", isSystem: false }, select: safeUserSelect });
}
export function updateManagedRole(tx: Prisma.TransactionClient, id: string, before: Role, role: Role) {
  return tx.user.updateMany({ where: { id, isSystem: false, role: before }, data: { role } });
}
export function updateManagedStatus(tx: Prisma.TransactionClient, id: string, before: UserStatus, status: "ACTIVE" | "DISABLED") {
  return tx.user.updateMany({ where: { id, isSystem: false, status: before }, data: { status } });
}
export function revokeActiveSessions(tx: Prisma.TransactionClient, userId: string, now: Date) {
  // Count only currently usable sessions, excluding expired and already revoked rows.
  return tx.session.updateMany({ where: { userId, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });
}

export async function listUserOptions() {
  // email distinguishes users with the same name; it is internal semi-public information.
  return prisma.user.findMany({
    where: { isSystem: false, status: "ACTIVE" },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}
