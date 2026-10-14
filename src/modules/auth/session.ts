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

async function setCookieCredential(credential: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, credential, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Use only after an upstream authentication flow has verified credentials. */
export async function setSessionCookie(userId: string): Promise<void> {
  await setCookieCredential(createSessionToken(userId, Date.now() + SESSION_TTL_SECONDS * 1000));
}

/** Set a database-backed credential after its Session row and audit event have committed. */
export async function setSessionCookieFromCredential(credential: string): Promise<void> {
  await setCookieCredential(credential);
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export type DatabaseSessionIdentity = Readonly<{ userId: string; sessionId: string }>;

/** Resolve only active database-backed sessions; legacy signed cookies are intentionally excluded. */
export async function resolveDatabaseSession(): Promise<DatabaseSessionIdentity | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes");
  }

  const databaseClaims = verifyDatabaseSessionCredential(token, secret);
  if (!databaseClaims) return null;

  const session = await prisma.session.findUnique({
    where: { id: databaseClaims.sessionId },
    select: {
      userId: true,
      tokenHash: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { id: true, status: true } },
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

  return { userId: session.userId, sessionId: databaseClaims.sessionId };
}

/** Return the current database session identity, never a legacy-cookie identity. */
export async function getCurrentSession(): Promise<DatabaseSessionIdentity | null> {
  return resolveDatabaseSession();
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const databaseSession = await resolveDatabaseSession();
  if (databaseSession) {
    const user = await prisma.user.findUnique({
      where: { id: databaseSession.userId },
      select: { id: true, role: true, status: true },
    });
    if (!user || user.status !== "ACTIVE") return null;
    return { id: user.id, role: user.role };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes");
  }

  // Temporary compatibility path: legacy-cookie users incur one extra Session lookup on each request.
  // Remove this fallback after the legacy cookies expire to eliminate that overhead.
  const claims = verifySessionToken(token, secret);
  if (!claims) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return null;
  return { id: user.id, role: user.role };
}
