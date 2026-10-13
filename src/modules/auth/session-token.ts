import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const sessionClaimsSchema = z.object({
  userId: z.uuid(),
  expiresAt: z.number().int().positive(),
}).strict();

const databaseSessionClaimsSchema = z.object({
  sessionId: z.uuid(),
  userId: z.uuid(),
  secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.number().int().positive(),
}).strict();

export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes");
  }
  return secret;
}

function signature(encodedClaims: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedClaims).digest();
}

function requireSigningSecret(secret: string): string {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes");
  }
  return secret;
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
}

/** Called only after an authentication provider has verified the user's credentials. */
export function createSessionToken(userId: string, expiresAt: number, secret = getSessionSecret()): string {
  const parsed = sessionClaimsSchema.safeParse({ userId, expiresAt });
  const now = Date.now();
  if (!parsed.success || expiresAt <= now || expiresAt > now + SESSION_TTL_SECONDS * 1000) {
    throw new Error("Invalid session claims");
  }
  const encodedClaims = Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
  return `${encodedClaims}.${signature(encodedClaims, secret).toString("base64url")}`;
}

export function verifySessionToken(token: string, secret: string, now = Date.now()): SessionClaims | null {
  if (token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let suppliedSignature: Buffer;
  let claimsValue: unknown;
  try {
    suppliedSignature = Buffer.from(parts[1], "base64url");
    if (suppliedSignature.length !== 32) return null;
    const expectedSignature = signature(parts[0], secret);
    if (!timingSafeEqual(suppliedSignature, expectedSignature)) return null;
    claimsValue = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const claims = sessionClaimsSchema.safeParse(claimsValue);
  if (
    !claims.success ||
    claims.data.expiresAt <= now ||
    claims.data.expiresAt > now + SESSION_TTL_SECONDS * 1000
  ) return null;
  return claims.data;
}

/** Create a signed database-backed credential; store only tokenHash in Session. */
export function createDatabaseSessionCredential(
  userId: string,
  expiresAt: number,
  signingSecret = getSessionSecret(),
): { credential: string; sessionId: string; tokenHash: string } {
  requireSigningSecret(signingSecret);
  const sessionId = randomUUID();
  const sessionSecret = randomBytes(32).toString("base64url");
  const parsed = databaseSessionClaimsSchema.safeParse({ sessionId, userId, secret: sessionSecret, expiresAt });
  const now = Date.now();
  if (!parsed.success || expiresAt <= now || expiresAt > now + SESSION_TTL_SECONDS * 1000) {
    throw new Error("Invalid database session claims");
  }

  const encodedClaims = Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
  const credential = `${encodedClaims}.${signature(encodedClaims, signingSecret).toString("base64url")}`;
  return {
    credential,
    sessionId,
    tokenHash: hashDatabaseSessionCredential(sessionId, sessionSecret),
  };
}

/** Hash the public session ID together with its random, per-session secret. */
export function hashDatabaseSessionCredential(sessionId: string, sessionSecret: string): string {
  if (!z.uuid().safeParse(sessionId).success || !/^[A-Za-z0-9_-]{43}$/.test(sessionSecret)) {
    throw new Error("Invalid database session credential parts");
  }
  return createHash("sha256").update(sessionId + sessionSecret, "utf8").digest("hex");
}

/**
 * Verify a database-backed credential without requiring its Session row to exist.
 * Callers should use the returned tokenHash to query Session instead of re-hashing the raw credential.
 */
export function verifyDatabaseSessionCredential(
  credential: string,
  signingSecret = getSessionSecret(),
  now = Date.now(),
): { sessionId: string; userId: string; tokenHash: string } | null {
  requireSigningSecret(signingSecret);
  if (credential.length > 4096) return null;
  const parts = credential.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const payloadBytes = decodeBase64Url(parts[0]);
  const suppliedSignature = decodeBase64Url(parts[1]);
  if (!payloadBytes || !suppliedSignature || suppliedSignature.length !== 32) return null;

  const expectedSignature = signature(parts[0], signingSecret);
  // Constant-time comparison avoids leaking partial signature matches through timing.
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) return null;

  let claimsValue: unknown;
  try {
    claimsValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    return null;
  }

  const claims = databaseSessionClaimsSchema.safeParse(claimsValue);
  if (
    !claims.success ||
    claims.data.expiresAt <= now ||
    claims.data.expiresAt > now + SESSION_TTL_SECONDS * 1000
  ) return null;
  return {
    sessionId: claims.data.sessionId,
    userId: claims.data.userId,
    tokenHash: hashDatabaseSessionCredential(claims.data.sessionId, claims.data.secret),
  };
}
