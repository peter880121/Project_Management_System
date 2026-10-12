import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const sessionClaimsSchema = z.object({
  userId: z.uuid(),
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
