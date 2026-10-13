import { describe, expect, it } from "vitest";
import {
  createDatabaseSessionCredential,
  createSessionToken,
  hashDatabaseSessionCredential,
  SESSION_TTL_SECONDS,
  verifyDatabaseSessionCredential,
  verifySessionToken,
} from "./session-token";

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

describe("database-backed session credentials", () => {
  function createCredential(expiresAt = Date.now() + 60_000) {
    return createDatabaseSessionCredential(userId, expiresAt, secret);
  }

  function decodeClaims(credential: string): { sessionId: string; userId: string; secret: string; expiresAt: number } {
    const [payload] = credential.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sessionId: string;
      userId: string;
      secret: string;
      expiresAt: number;
    };
  }

  it("creates a random signed credential and stores only its session secret hash", () => {
    const created = createCredential();
    const claims = decodeClaims(created.credential);

    expect(created.sessionId).toBe(claims.sessionId);
    expect(claims.userId).toBe(userId);
    expect(created.tokenHash).toBe(hashDatabaseSessionCredential(created.sessionId, claims.secret));
    expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createCredential().credential).not.toBe(created.credential);
  });

  it("hashes the same session credential deterministically", () => {
    const sessionSecret = decodeClaims(createCredential().credential).secret;
    const first = hashDatabaseSessionCredential("00000000-0000-4000-8000-000000000010", sessionSecret);
    const second = hashDatabaseSessionCredential("00000000-0000-4000-8000-000000000010", sessionSecret);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects malformed session credential parts before hashing", () => {
    const sessionSecret = decodeClaims(createCredential().credential).secret;
    expect(() => hashDatabaseSessionCredential("not-a-uuid", sessionSecret)).toThrow();
    expect(() => hashDatabaseSessionCredential("00000000-0000-4000-8000-000000000010", "too-short")).toThrow();
  });

  it("verifies a valid credential and returns its session identity and token hash", () => {
    const created = createCredential();
    expect(verifyDatabaseSessionCredential(created.credential, secret)).toEqual({
      sessionId: created.sessionId,
      userId,
      tokenHash: created.tokenHash,
    });
  });

  it("rejects a modified payload", () => {
    const created = createCredential();
    const [payload, suppliedSignature] = created.credential.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    claims.userId = "00000000-0000-4000-8000-000000000002";
    const changedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    expect(verifyDatabaseSessionCredential(`${changedPayload}.${suppliedSignature}`, secret)).toBeNull();
  });

  it("rejects a modified signature", () => {
    const created = createCredential();
    const [payload, suppliedSignature] = created.credential.split(".");
    const changedSignature = `${suppliedSignature[0] === "A" ? "B" : "A"}${suppliedSignature.slice(1)}`;
    expect(verifyDatabaseSessionCredential(`${payload}.${changedSignature}`, secret)).toBeNull();
  });

  it("rejects an expired credential", () => {
    const expiresAt = Date.now() + 60_000;
    const created = createCredential(expiresAt);
    expect(verifyDatabaseSessionCredential(created.credential, secret, expiresAt)).toBeNull();
  });

  it("rejects invalid Base64URL payloads", () => {
    const created = createCredential();
    const [, suppliedSignature] = created.credential.split(".");
    expect(verifyDatabaseSessionCredential(`%%%invalid.${suppliedSignature}`, secret)).toBeNull();
  });

  it.each([
    ["empty credential", ""],
    ["three-part credential", "one.two.three"],
    ["oversized credential", "a".repeat(4097)],
    ["signature with the wrong decoded length", "YQ.YQ"],
  ])("returns null without throwing for %s", (_description, malformedCredential) => {
    expect(verifyDatabaseSessionCredential(malformedCredential, secret)).toBeNull();
  });
});
