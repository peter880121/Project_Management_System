import { describe, expect, it } from "vitest";
import { createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from "./session-token";

const secret = "synthetic-test-session-secret-32-bytes";
const userId = "00000000-0000-4000-8000-000000000001";

describe("signed sessions", () => {
  it("verifies a signed, unexpired user session", () => {
    const now = Date.now();
    const token = createSessionToken(userId, now + SESSION_TTL_SECONDS * 1000, secret);
    expect(verifySessionToken(token, secret, now)).toEqual({ userId, expiresAt: now + SESSION_TTL_SECONDS * 1000 });
  });

  it("rejects a tampered or expired token", () => {
    const now = Date.now();
    const token = createSessionToken(userId, now + 60_000, secret);
    const [payload, signature] = token.split(".");
    const tampered = `${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    expect(verifySessionToken(tampered, secret, now)).toBeNull();
    expect(verifySessionToken(token, secret, now + 60_000)).toBeNull();
  });
});
