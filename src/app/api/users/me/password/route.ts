import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/service";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { requireRole } from "@/modules/auth/rbac";
import { getCurrentSession, getCurrentUser, setSessionCookieFromCredential } from "@/modules/auth/session";
import { rotateDatabaseSessionCredential } from "@/modules/auth/session-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authenticatedRoles = ["ADMIN", "PM", "MEMBER", "QA", "PMO"] as const;
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string()
    .min(8)
    .max(1024)
    .regex(/\p{L}/u, "新密码至少 8 位，且必须包含字母和数字")
    .regex(/[0-9]/, "新密码至少 8 位，且必须包含字母和数字"),
}).strict();

class PasswordChangeConflict extends Error {}

function requestMetadata(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return {
    ip: (forwardedFor || request.headers.get("x-real-ip") || "").slice(0, 45) || null,
    userAgent: request.headers.get("user-agent")?.slice(0, 512) || null,
  };
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  const parsed = passwordChangeSchema.safeParse(body);
  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.some((issue) => issue.path[0] === "newPassword");
    return NextResponse.json({ error: passwordIssue ? "新密码至少 8 位，且必须包含字母和数字" : "请求格式无效" }, { status: 400 });
  }
  const input = parsed.data;
  const metadata = requestMetadata(request);

  const currentSession = await getCurrentSession();
  if (!currentSession) {
    const legacyUser = await getCurrentUser();
    if (legacyUser) {
      return NextResponse.json({ error: "请重新登录以修改密码" }, { status: 401 });
    }
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: currentSession.userId },
    select: { id: true, role: true, status: true, passwordHash: true },
  });
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const denied = requireRole({ id: user.id, role: user.role }, authenticatedRoles);
  if (denied) return denied;

  let currentPasswordMatches = false;
  if (user.passwordHash) {
    try {
      currentPasswordMatches = await verifyPassword(input.currentPassword, user.passwordHash);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  if (!currentPasswordMatches) {
    return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
  }

  let newPasswordHash: string;
  try {
    newPasswordHash = await hashPassword(input.newPassword);
  } catch (error) {
    if (error instanceof RangeError) return NextResponse.json({ error: "密码不能超过 72 字节" }, { status: 400 });
    throw error;
  }

  try {
    const changed = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const session = await tx.session.findUnique({
        where: { id: currentSession.sessionId },
        select: { id: true, userId: true, expiresAt: true, revokedAt: true },
      });
      if (
        !session ||
        session.userId !== currentSession.userId ||
        session.revokedAt !== null ||
        session.expiresAt.getTime() <= now.getTime()
      ) return null;

      const rotated = rotateDatabaseSessionCredential(
        session.id,
        user.id,
        session.expiresAt.getTime(),
      );
      const rotatedSession = await tx.session.updateMany({
        where: { id: session.id, userId: user.id, revokedAt: null, expiresAt: { gt: now } },
        data: { tokenHash: rotated.tokenHash },
      });
      if (rotatedSession.count !== 1) return null;

      const passwordUpdated = await tx.user.updateMany({
        where: { id: user.id, status: "ACTIVE", passwordHash: user.passwordHash },
        data: { passwordHash: newPasswordHash },
      });
      if (passwordUpdated.count !== 1) throw new PasswordChangeConflict("Password changed concurrently");

      const revokedSessions = await tx.session.updateMany({
        where: { userId: user.id, id: { not: session.id }, revokedAt: null },
        data: { revokedAt: now },
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: "PASSWORD_CHANGED",
        entityType: "User",
        entityId: user.id,
        after: { changed: true, revokedOtherSessions: revokedSessions.count, currentSessionId: session.id },
        ip: metadata.ip,
        userAgent: metadata.userAgent,
      });
      return rotated.credential;
    });

    if (!changed) {
      return NextResponse.json({ error: "当前会话已失效，请重新登录" }, { status: 401 });
    }
    await setSessionCookieFromCredential(changed);
    return NextResponse.json({ message: "密码已更新" }, { status: 200 });
  } catch (error) {
    if (error instanceof PasswordChangeConflict) {
      return NextResponse.json({ error: "密码状态已变化，请重新登录后重试" }, { status: 409 });
    }
    return NextResponse.json({ error: "密码修改失败，请重试" }, { status: 500 });
  }
}
