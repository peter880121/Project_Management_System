import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { recordAudit } from "@/modules/audit/service";
import { clearSessionCookie, SESSION_COOKIE_NAME } from "@/modules/auth/session";
import { verifyDatabaseSessionCredential, verifySessionToken } from "@/modules/auth/session-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestMetadata(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return {
    ip: (forwardedFor || request.headers.get("x-real-ip") || "").slice(0, 45) || null,
    userAgent: request.headers.get("user-agent")?.slice(0, 512) || null,
  };
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const credential = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!credential) {
    await clearSessionCookie();
    return NextResponse.json({ message: "已登出" }, { status: 200 });
  }

  const secret = process.env.SESSION_SECRET;
  const canVerify = Boolean(secret && Buffer.byteLength(secret, "utf8") >= 32);
  const databaseClaims = canVerify ? verifyDatabaseSessionCredential(credential, secret!) : null;
  const legacyClaims = canVerify && !databaseClaims ? verifySessionToken(credential, secret!) : null;
  const userId = databaseClaims?.userId ?? legacyClaims?.userId ?? null;
  const actorId = userId ?? SYSTEM_USER_ID;
  const entityId = databaseClaims?.sessionId ?? legacyClaims?.userId ?? randomUUID();
  const metadata = requestMetadata(request);

  try {
    await prisma.$transaction(async (tx) => {
      let revoked = false;
      if (databaseClaims) {
        const result = await tx.session.updateMany({
          where: { id: databaseClaims.sessionId, userId: databaseClaims.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        revoked = result.count === 1;
        // A valid signed cookie with no Session row is already logged out; keep this idempotent and return 200.
      }
      await recordAudit(tx, {
        actorId,
        action: "LOGOUT",
        entityType: databaseClaims ? "Session" : userId ? "User" : "LoginAttempt",
        entityId,
        after: { revoked, ...(databaseClaims ? { sessionId: databaseClaims.sessionId } : {}) },
        ip: metadata.ip,
        userAgent: metadata.userAgent,
      });
    });
  } catch (error) {
    if (userId) {
      // For a known user, preserve the cookie so the caller can retry the atomic revoke-and-audit operation.
      return NextResponse.json({ error: "登出失败，请重试" }, { status: 500 });
    }
    // An unverifiable cookie has no trusted actor; audit is best effort and must not prevent local sign-out.
    console.error("Could not audit logout attempt without a verified user", error);
  }

  await clearSessionCookie();
  return NextResponse.json({ message: "已登出" }, { status: 200 });
}
