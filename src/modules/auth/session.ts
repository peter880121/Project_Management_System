import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "./rbac";
import {
  createSessionToken,
  SESSION_TTL_SECONDS,
  verifyDatabaseSessionCredential,
  verifySessionToken,
} from "./session-token";

export const SESSION_COOKIE_NAME = "medpm_session";

/** Use only after an upstream login flow has verified credentials. */
export async function setSessionCookie(userId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, createSessionToken(userId, Date.now() + SESSION_TTL_SECONDS * 1000), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Set a database-backed credential after its Session row and audit event have committed. */
export async function setDatabaseSessionCookie(credential: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, credential, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes");
  }

  const databaseClaims = verifyDatabaseSessionCredential(token, secret);
  if (databaseClaims) {
    const session = await prisma.session.findUnique({
      where: { id: databaseClaims.sessionId },
      select: {
        userId: true,
        tokenHash: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { id: true, role: true, status: true } },
      },
    });
    if (
      !session ||
      session.userId !== databaseClaims.userId ||
      session.user.id !== databaseClaims.userId ||
      session.tokenHash !== databaseClaims.tokenHash ||
      session.expiresAt.getTime() <= Date.now() ||
      session.revokedAt !== null ||
      session.user.status !== "ACTIVE"
    ) return null;
    return { id: session.user.id, role: session.user.role };
  }

  // Temporary compatibility path: accept unexpired legacy cookies until their original TTL passes.
  const claims = verifySessionToken(token, secret);
  if (!claims) return null;

  return prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, role: true },
  });
}
