import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { verifyPassword } from "@/modules/auth/password";
import { setDatabaseSessionCookie } from "@/modules/auth/session";
import { recordFailedPasswordAttempt } from "@/modules/auth/login-policy";
import { createDatabaseSessionCredential, SESSION_TTL_SECONDS } from "@/modules/auth/session-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().email().max(191).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(1024),
}).strict();

const INVALID_CREDENTIALS = "邮箱或密码错误";

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function requestMetadata(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return {
    ip: (forwardedFor || request.headers.get("x-real-ip") || "").slice(0, 45) || null,
    userAgent: request.headers.get("user-agent")?.slice(0, 512) || null,
  };
}

async function recordFailedAttempt(input: {
  userId: string | null;
  email: string;
  reason: string;
  metadata: ReturnType<typeof requestMetadata>;
  now: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const actorId = input.userId ?? SYSTEM_USER_ID;
    const entityId = input.userId ?? randomUUID();
    if (input.userId) {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true, failedLoginCount: true, lockedUntil: true },
      });
      if (user?.status === "ACTIVE" && user.lockedUntil && user.lockedUntil.getTime() > input.now.getTime()) {
        await tx.auditLog.create({ data: {
          actorId,
          action: "LOGIN_FAILED",
          entityType: "User",
          entityId,
          after: { targetEmail: maskEmail(input.email), reason: "locked" },
          ip: input.metadata.ip,
          userAgent: input.metadata.userAgent,
        } });
        return "locked" as const;
      }
      if (user?.status === "ACTIVE") {
        if (user.lockedUntil && user.lockedUntil.getTime() <= input.now.getTime()) {
          await tx.user.updateMany({
            where: { id: user.id, lockedUntil: { lte: input.now } },
            data: { failedLoginCount: 0, lockedUntil: null },
          });
        }
        const incremented = await tx.user.updateMany({
          where: { id: user.id, status: "ACTIVE", lockedUntil: null },
          data: { failedLoginCount: { increment: 1 } },
        });
        if (incremented.count === 1) {
          const updated = await tx.user.findUnique({
            where: { id: user.id },
            select: { failedLoginCount: true, lockedUntil: true },
          });
          const nextState = updated ? recordFailedPasswordAttempt({
            failedLoginCount: Math.max(0, updated.failedLoginCount - 1),
            lockedUntil: null,
            now: input.now,
          }) : null;
          if (nextState?.locked && updated?.lockedUntil === null) {
            await tx.user.updateMany({
              where: { id: user.id, status: "ACTIVE", lockedUntil: null },
              data: { lockedUntil: nextState.lockedUntil },
            });
          }
        }
      }
    }
    await tx.auditLog.create({ data: {
      actorId,
      action: "LOGIN_FAILED",
      entityType: input.userId ? "User" : "LoginAttempt",
      entityId,
      after: { targetEmail: maskEmail(input.email), reason: input.reason },
      ip: input.metadata.ip,
      userAgent: input.metadata.userAgent,
    } });
    return "invalid" as const;
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "请求格式无效" }, { status: 400 });

  const input = parsed.data;
  const metadata = requestMetadata(request);
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });
  const now = new Date();

  if (!user) {
    await recordFailedAttempt({ userId: null, email: input.email, reason: "invalid_credentials", metadata, now });
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }
  if (user.status === "PENDING") {
    await recordFailedAttempt({ userId: user.id, email: input.email, reason: "pending", metadata, now });
    // Product decision: the helpful activation message confirms this email has a PENDING account (P3 enumeration risk).
    return NextResponse.json({ error: "等待管理员激活" }, { status: 403 });
  }
  if (user.status === "DISABLED") {
    await recordFailedAttempt({ userId: user.id, email: input.email, reason: "disabled", metadata, now });
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await recordFailedAttempt({ userId: user.id, email: input.email, reason: "locked", metadata, now });
    // Product decision: expose the lock state and recovery time; locked retries never extend the lock.
    return NextResponse.json({ error: "账号已锁定，请 15 分钟后重试" }, { status: 423 });
  }

  let passwordMatches = false;
  if (user.passwordHash) {
    try {
      passwordMatches = await verifyPassword(input.password, user.passwordHash);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  if (!passwordMatches) {
    const failure = await recordFailedAttempt({ userId: user.id, email: input.email, reason: "invalid_credentials", metadata, now });
    if (failure === "locked") {
      // A concurrent failed attempt may have locked the account while this request was checking the password.
      return NextResponse.json({ error: "账号已锁定，请 15 分钟后重试" }, { status: 423 });
    }
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const credential = createDatabaseSessionCredential(user.id, expiresAt.getTime());
  const authenticated = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: user.id }, select: { id: true, status: true, lockedUntil: true } });
    if (!current || current.status !== "ACTIVE") return { kind: "inactive" as const };
    if (current.lockedUntil && current.lockedUntil.getTime() > now.getTime()) return { kind: "locked" as const };

    if (current.lockedUntil && current.lockedUntil.getTime() <= now.getTime()) {
      await tx.user.updateMany({
        where: { id: user.id, lockedUntil: { lte: now } },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }
    const updated = await tx.user.updateMany({
      where: { id: user.id, status: "ACTIVE", OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    if (updated.count !== 1) return { kind: "locked" as const };

    await tx.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: now } } });
    await tx.session.create({ data: {
      id: credential.sessionId,
      userId: user.id,
      tokenHash: credential.tokenHash,
      expiresAt,
      ip: metadata.ip,
      userAgent: metadata.userAgent,
    } });
    await tx.auditLog.create({ data: {
      actorId: user.id,
      action: "LOGIN_SUCCESS",
      entityType: "User",
      entityId: user.id,
      after: { targetEmail: maskEmail(input.email), sessionId: credential.sessionId },
      ip: metadata.ip,
      userAgent: metadata.userAgent,
    } });
    return { kind: "success" as const };
  });

  if (authenticated.kind === "inactive") {
    await recordFailedAttempt({ userId: user.id, email: input.email, reason: "inactive_during_login", metadata, now });
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }
  if (authenticated.kind === "locked") {
    await recordFailedAttempt({ userId: user.id, email: input.email, reason: "locked", metadata, now });
    return NextResponse.json({ error: "账号已锁定，请 15 分钟后重试" }, { status: 423 });
  }

  await setDatabaseSessionCookie(credential.credential);
  return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }, { status: 200 });
}
