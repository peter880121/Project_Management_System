import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { hashPassword } from "@/modules/auth/password";
import { createManagedUser, findManagementIdentity, lockUsers, revokeActiveSessions, updateManagedRole, updateManagedStatus } from "./repositories";
import type { CreateUserInput } from "./schemas";

export class UserManagementError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

type Transaction = Parameters<typeof findManagementIdentity>[0];
async function assertAdmin(tx: Transaction, actorId: string) {
  const actor = await findManagementIdentity(tx, actorId);
  if (!actor || actor.status !== "ACTIVE") throw new UserManagementError(401, "Authentication required");
  if (actor.role !== "ADMIN" || actor.isSystem) throw new UserManagementError(403, "Forbidden");
}
async function getTarget(tx: Transaction, actorId: string, userId: string) {
  if (actorId === userId) throw new UserManagementError(403, "不能修改自己的角色或状态");
  const user = await findManagementIdentity(tx, userId);
  if (!user) throw new UserManagementError(404, "用户不存在");
  if (actorId.toLowerCase() === user.id.toLowerCase()) throw new UserManagementError(403, "不能修改自己的角色或状态");
  if (user.isSystem) throw new UserManagementError(403, "不能修改系统账号");
  return user;
}

export async function createUserByAdmin(input: CreateUserInput & { actorId: string } & AuditRequestMetadata) {
  const passwordHash = await hashPassword(input.initialPassword);
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, [input.actorId]);
    await assertAdmin(tx, input.actorId);
    const user = await createManagedUser(tx, { name: input.name, email: input.email, role: input.role, passwordHash });
    const [local, domain] = user.email.split("@");
    await recordAudit(tx, {
      actorId: input.actorId, action: "USER_CREATED_BY_ADMIN", entityType: "User", entityId: user.id,
      after: { id: user.id, email: `${local.slice(0, 1)}***@${domain}`, role: user.role, status: user.status },
      ip: input.ip, userAgent: input.userAgent,
    });
    return user;
  });
}

export async function changeManagedUserRole(input: { actorId: string; userId: string; role: Role } & AuditRequestMetadata) {
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, [input.actorId, input.userId]);
    await assertAdmin(tx, input.actorId);
    const user = await getTarget(tx, input.actorId, input.userId);
    if (user.role === input.role) throw new UserManagementError(409, "账号角色已变化或未发生变化，请刷新");
    const changed = await updateManagedRole(tx, user.id, user.role, input.role);
    if (changed.count !== 1) throw new UserManagementError(409, "账号角色已变化，请刷新");
    await recordAudit(tx, {
      actorId: input.actorId, action: "PERMISSION_CHANGED", entityType: "User", entityId: user.id,
      before: { role: user.role }, after: { role: input.role }, ip: input.ip, userAgent: input.userAgent,
    });
    return { id: user.id, role: input.role };
  });
}

export async function changeManagedUserStatus(input: { actorId: string; userId: string; status: "ACTIVE" | "DISABLED" } & AuditRequestMetadata) {
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, [input.actorId, input.userId]);
    await assertAdmin(tx, input.actorId);
    const user = await getTarget(tx, input.actorId, input.userId);
    const allowed = input.status === "ACTIVE" ? user.status === "PENDING" || user.status === "DISABLED" : user.status === "ACTIVE";
    if (!allowed) throw new UserManagementError(409, "账号状态已变化，请刷新");
    const changed = await updateManagedStatus(tx, user.id, user.status, input.status);
    if (changed.count !== 1) throw new UserManagementError(409, "账号状态已变化，请刷新");
    const now = new Date();
    const revoked = input.status === "DISABLED" ? await revokeActiveSessions(tx, user.id, now) : { count: 0 };
    await recordAudit(tx, {
      actorId: input.actorId, action: "USER_STATUS_CHANGED", entityType: "User", entityId: user.id,
      before: { status: user.status },
      // updateMany's affected-row count: 5 sessions with 2 expired => 3, never 5.
      after: { status: input.status, revokedActiveSessionCount: revoked.count }, ip: input.ip, userAgent: input.userAgent,
    });
    return { id: user.id, status: input.status };
  });
}
