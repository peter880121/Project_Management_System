import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCookieMock, prismaMock } = vi.hoisted(() => ({
  getCookieMock: vi.fn(),
  prismaMock: {
    session: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: getCookieMock })) }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { getCurrentUser } from "./session";
import { createDatabaseSessionCredential, createSessionToken, SESSION_TTL_SECONDS } from "./session-token";

const signingSecret = "session-auth-test-signing-secret-32-bytes";
const userId = "00000000-0000-4000-8000-000000000123";

describe("getCurrentUser cookie transition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = signingSecret;
    getCookieMock.mockReturnValue(undefined);
    prismaMock.session.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
  });

  it("accepts a valid database-backed cookie whose Session row is active", async () => {
    const expiresAt = Date.now() + 60_000;
    const created = createDatabaseSessionCredential(userId, expiresAt, signingSecret);
    getCookieMock.mockReturnValue({ value: created.credential });
    prismaMock.session.findUnique.mockResolvedValue({
      userId,
      tokenHash: created.tokenHash,
      expiresAt: new Date(expiresAt),
      revokedAt: null,
      user: { id: userId, role: "PM", status: "ACTIVE" },
    });

    await expect(getCurrentUser()).resolves.toEqual({ id: userId, role: "PM" });
    expect(prismaMock.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: created.sessionId } }));
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["missing Session row", null],
    ["revoked Session", { revokedAt: new Date() }],
    ["expired Session", { expiresAt: new Date(Date.now() - 1000) }],
    ["inactive account", { user: { id: userId, role: "PM", status: "PENDING" } }],
  ])("rejects a database-backed cookie with %s", async (_label, override) => {
    const created = createDatabaseSessionCredential(userId, Date.now() + 60_000, signingSecret);
    getCookieMock.mockReturnValue({ value: created.credential });
    prismaMock.session.findUnique.mockResolvedValue(override === null ? null : {
      userId,
      tokenHash: created.tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: { id: userId, role: "PM", status: "ACTIVE" },
      ...override,
    });

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("continues to accept an unexpired legacy cookie during the transition", async () => {
    const legacyCookie = createSessionToken(userId, Date.now() + SESSION_TTL_SECONDS * 1000, signingSecret);
    getCookieMock.mockReturnValue({ value: legacyCookie });
    prismaMock.user.findUnique.mockResolvedValue({ id: userId, role: "PM" });

    await expect(getCurrentUser()).resolves.toEqual({ id: userId, role: "PM" });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: userId } }));
  });
});
