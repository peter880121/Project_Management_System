import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieGetMock, clearCookieMock, tx, prismaMock, recordAuditMock } = vi.hoisted(() => ({
  cookieGetMock: vi.fn(),
  clearCookieMock: vi.fn(),
  tx: { session: { updateMany: vi.fn() } },
  prismaMock: { $transaction: vi.fn() },
  recordAuditMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: cookieGetMock })) }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/auth/session", () => ({
  SESSION_COOKIE_NAME: "medpm_session",
  clearSessionCookie: clearCookieMock,
}));
vi.mock("@/modules/audit/service", () => ({ recordAudit: recordAuditMock }));

import { SYSTEM_USER_ID } from "@/lib/system-user";
import { POST } from "./route";
import { createDatabaseSessionCredential, createSessionToken } from "@/modules/auth/session-token";

const signingSecret = "logout-route-test-session-secret-32-bytes";
const userId = "00000000-0000-4000-8000-000000000123";

function requestForLogout() {
  return new Request("http://localhost/api/auth/logout", {
    method: "POST",
    headers: { "x-forwarded-for": "192.0.2.18", "user-agent": "logout-vitest" },
  });
}

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = signingSecret;
    cookieGetMock.mockReturnValue(undefined);
    tx.session.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));
    recordAuditMock.mockResolvedValue(undefined);
    clearCookieMock.mockResolvedValue(undefined);
  });

  it("revokes the current Session and writes LOGOUT before clearing the cookie", async () => {
    const created = createDatabaseSessionCredential(userId, Date.now() + 60_000, signingSecret);
    cookieGetMock.mockReturnValue({ value: created.credential });

    const response = await POST(requestForLogout());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "已登出" });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { id: created.sessionId, userId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(recordAuditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorId: userId,
      action: "LOGOUT",
      entityType: "Session",
      entityId: created.sessionId,
      after: { revoked: true, sessionId: created.sessionId },
      ip: "192.0.2.18",
      userAgent: "logout-vitest",
    }));
    expect(clearCookieMock).toHaveBeenCalledOnce();
  });

  it("returns 200 and audits logout when a valid cookie has no Session row", async () => {
    const created = createDatabaseSessionCredential(userId, Date.now() + 60_000, signingSecret);
    cookieGetMock.mockReturnValue({ value: created.credential });
    tx.session.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(requestForLogout());

    expect(response.status).toBe(200);
    expect(recordAuditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorId: userId,
      action: "LOGOUT",
      after: { revoked: false, sessionId: created.sessionId },
    }));
    expect(clearCookieMock).toHaveBeenCalledOnce();
  });

  it("accepts a valid legacy cookie, audits its user, and clears it", async () => {
    const credential = createSessionToken(userId, Date.now() + 60_000, signingSecret);
    cookieGetMock.mockReturnValue({ value: credential });

    const response = await POST(requestForLogout());

    expect(response.status).toBe(200);
    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(recordAuditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorId: userId,
      action: "LOGOUT",
      entityType: "User",
    }));
    expect(clearCookieMock).toHaveBeenCalledOnce();
  });

  it("best-effort audits an unverifiable cookie as a system event", async () => {
    cookieGetMock.mockReturnValue({ value: "tampered-or-expired-cookie" });

    const response = await POST(requestForLogout());

    expect(response.status).toBe(200);
    expect(recordAuditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorId: SYSTEM_USER_ID,
      action: "LOGOUT",
      entityType: "LoginAttempt",
    }));
    expect(clearCookieMock).toHaveBeenCalledOnce();
  });

  it("returns 200 and clears the cookie when none is present", async () => {
    const response = await POST(requestForLogout());

    expect(response.status).toBe(200);
    expect(recordAuditMock).not.toHaveBeenCalled();
    expect(clearCookieMock).toHaveBeenCalledOnce();
  });

  it("keeps a verified user's cookie and returns 500 when audit fails", async () => {
    const created = createDatabaseSessionCredential(userId, Date.now() + 60_000, signingSecret);
    cookieGetMock.mockReturnValue({ value: created.credential });
    recordAuditMock.mockRejectedValue(new Error("audit unavailable"));

    const response = await POST(requestForLogout());

    expect(response.status).toBe(500);
    expect(clearCookieMock).not.toHaveBeenCalled();
  });

  it("still clears an unverifiable cookie if the best-effort audit fails", async () => {
    cookieGetMock.mockReturnValue({ value: "tampered-cookie" });
    recordAuditMock.mockRejectedValue(new Error("audit unavailable"));

    const response = await POST(requestForLogout());

    expect(response.status).toBe(200);
    expect(clearCookieMock).toHaveBeenCalledOnce();
  });
});
