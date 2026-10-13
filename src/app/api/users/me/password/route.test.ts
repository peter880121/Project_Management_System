import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, prismaMock, getCurrentSessionMock, getCurrentUserMock, setCookieMock, verifyPasswordMock, hashPasswordMock, rotateCredentialMock, recordAuditMock } = vi.hoisted(() => ({
  tx: {
    session: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { updateMany: vi.fn() },
  },
  prismaMock: { user: { findUnique: vi.fn() }, $transaction: vi.fn() },
  getCurrentSessionMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  setCookieMock: vi.fn(),
  verifyPasswordMock: vi.fn(),
  hashPasswordMock: vi.fn(),
  rotateCredentialMock: vi.fn(),
  recordAuditMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/audit/service", () => ({ recordAudit: recordAuditMock }));
vi.mock("@/modules/auth/password", () => ({ hashPassword: hashPasswordMock, verifyPassword: verifyPasswordMock }));
vi.mock("@/modules/auth/session", () => ({
  getCurrentSession: getCurrentSessionMock,
  getCurrentUser: getCurrentUserMock,
  setSessionCookieFromCredential: setCookieMock,
}));
vi.mock("@/modules/auth/session-token", () => ({ rotateDatabaseSessionCredential: rotateCredentialMock }));

import { PATCH } from "./route";

const userId = "00000000-0000-4000-8000-000000000123";
const sessionId = "00000000-0000-4000-8000-000000000456";
const oldPasswordHash = "$2b$12$old-password-hash";
const activeSession = { id: sessionId, userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000), revokedAt: null };
const activeUser = { id: userId, role: "PM" as const, status: "ACTIVE", passwordHash: oldPasswordHash };

function requestFor(body: unknown) {
  return new Request("http://localhost/api/users/me/password", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.27", "user-agent": "password-change-vitest" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/users/me/password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({ userId, sessionId });
    getCurrentUserMock.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(activeUser);
    tx.session.findUnique.mockResolvedValue(activeSession);
    tx.session.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 2 });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));
    verifyPasswordMock.mockResolvedValue(true);
    hashPasswordMock.mockResolvedValue("$2b$12$new-password-hash");
    rotateCredentialMock.mockReturnValue({ credential: "rotated-database-cookie", tokenHash: "b".repeat(64) });
    recordAuditMock.mockResolvedValue(undefined);
    setCookieMock.mockResolvedValue(undefined);
  });

  it("updates the password, rotates the current Session and revokes other sessions atomically", async () => {
    const response = await PATCH(requestFor({ currentPassword: "OldPassword123", newPassword: "NewPassword456" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "密码已更新" });
    expect(verifyPasswordMock).toHaveBeenCalledWith("OldPassword123", oldPasswordHash);
    expect(hashPasswordMock).toHaveBeenCalledWith("NewPassword456");
    expect(rotateCredentialMock).toHaveBeenCalledWith(sessionId, userId, activeSession.expiresAt.getTime());
    expect(tx.session.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { tokenHash: "b".repeat(64) },
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: userId, status: "ACTIVE", passwordHash: oldPasswordHash },
      data: { passwordHash: "$2b$12$new-password-hash" },
    });
    expect(tx.session.updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId, id: { not: sessionId }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(recordAuditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorId: userId,
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: userId,
      after: { changed: true, revokedOtherSessions: 2, currentSessionId: sessionId },
      ip: "192.0.2.27",
      userAgent: "password-change-vitest",
    }));
    expect(setCookieMock).toHaveBeenCalledWith("rotated-database-cookie");
  });

  it("rejects an incorrect current password without writing data", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    const response = await PATCH(requestFor({ currentPassword: "WrongPassword123", newPassword: "NewPassword456" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "当前密码不正确" });
    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["too short", "short1"],
    ["without a digit", "PasswordOnly"],
    ["without a letter", "12345678"],
  ])("rejects a new password %s before checking the current password", async (_label, newPassword) => {
    const response = await PATCH(requestFor({ currentPassword: "OldPassword123", newPassword }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "新密码至少 8 位，且必须包含字母和数字" });
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the new password exceeds bcrypt's 72-byte limit", async () => {
    hashPasswordMock.mockRejectedValue(new RangeError("too long"));

    const response = await PATCH(requestFor({ currentPassword: "OldPassword123", newPassword: "A1".repeat(37) }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "密码不能超过 72 字节" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns 401 with the specified message for a legacy cookie", async () => {
    getCurrentSessionMock.mockResolvedValue(null);
    getCurrentUserMock.mockResolvedValue({ id: userId, role: "PM" });

    const response = await PATCH(requestFor({ currentPassword: "OldPassword123", newPassword: "NewPassword456" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请重新登录以修改密码" });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no valid current session", async () => {
    getCurrentSessionMock.mockResolvedValue(null);
    getCurrentUserMock.mockResolvedValue(null);

    const response = await PATCH(requestFor({ currentPassword: "OldPassword123", newPassword: "NewPassword456" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });

  it("returns 401 if the database session is no longer active", async () => {
    tx.session.findUnique.mockResolvedValue(null);

    const response = await PATCH(requestFor({ currentPassword: "OldPassword123", newPassword: "NewPassword456" }));

    expect(response.status).toBe(401);
    expect(setCookieMock).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back and does not issue a new cookie when the audit write fails", async () => {
    recordAuditMock.mockRejectedValue(new Error("audit unavailable"));

    const response = await PATCH(requestFor({ currentPassword: "OldPassword123", newPassword: "NewPassword456" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "密码修改失败，请重试" });
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it("returns 409 if the password changed concurrently", async () => {
    tx.user.updateMany.mockResolvedValue({ count: 0 });

    const response = await PATCH(requestFor({ currentPassword: "OldPassword123", newPassword: "NewPassword456" }));

    expect(response.status).toBe(409);
    expect(setCookieMock).not.toHaveBeenCalled();
  });
});
