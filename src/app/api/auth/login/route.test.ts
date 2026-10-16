import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tx, prismaMock, verifyPasswordMock, setCookieMock, createCredentialMock } = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
    session: { deleteMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  prismaMock: { user: { findUnique: vi.fn() }, $transaction: vi.fn() },
  verifyPasswordMock: vi.fn(),
  setCookieMock: vi.fn(),
  createCredentialMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/auth/password", () => ({ verifyPassword: verifyPasswordMock }));
vi.mock("@/modules/auth/session", () => ({ setSessionCookieFromCredential: setCookieMock }));
vi.mock("@/modules/auth/session-token", () => ({
  createDatabaseSessionCredential: createCredentialMock,
  SESSION_TTL_SECONDS: 8 * 60 * 60,
}));

import { POST } from "./route";
import { Prisma } from "@prisma/client";

const activeUser = {
  id: "00000000-0000-4000-8000-000000000123",
  email: "pm@example.test",
  name: "Synthetic PM",
  role: "PM",
  status: "ACTIVE",
  passwordHash: "$2b$12$synthetic-hash",
  failedLoginCount: 0,
  lockedUntil: null,
};

function requestFor(body: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.44", "user-agent": "login-vitest" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.user.findUnique.mockResolvedValue({ id: activeUser.id, status: "ACTIVE", passwordHash: activeUser.passwordHash, lockedUntil: null, failedLoginCount: 0 });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.session.deleteMany.mockResolvedValue({ count: 0 });
    tx.session.create.mockResolvedValue({ id: "session-id" });
    tx.auditLog.create.mockResolvedValue({ id: "audit-id" });
    prismaMock.user.findUnique.mockResolvedValue(activeUser);
    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));
    verifyPasswordMock.mockResolvedValue(true);
    setCookieMock.mockResolvedValue(undefined);
    createCredentialMock.mockReturnValue({ credential: "signed-db-credential", sessionId: "session-id", tokenHash: "a".repeat(64) });
  });

  afterEach(() => vi.clearAllMocks());

  it("creates a DB session and success audit before setting the signed cookie", async () => {
    const response = await POST(requestFor({ email: "PM@example.test", password: "Password123" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: activeUser.id, email: activeUser.email, name: activeUser.name, role: "PM" } });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: activeUser.id, expiresAt: { lt: expect.any(Date) } } });
    expect(tx.session.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: activeUser.id, tokenHash: "a".repeat(64) }) });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: activeUser.id, action: "LOGIN_SUCCESS" }) });
    expect(setCookieMock).toHaveBeenCalledWith("signed-db-credential");
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.user.findUnique.mock.invocationCallOrder[0]!);
  });

  it("returns the generic credential error and associates known-email audit with that user", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    tx.user.findUnique.mockResolvedValue({ status: "ACTIVE", lockedUntil: null, failedLoginCount: 1 });
    const response = await POST(requestFor({ email: activeUser.email, password: "WrongPass123" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "邮箱或密码错误" });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: activeUser.id, action: "LOGIN_FAILED", after: { targetEmail: "p***@example.test", reason: "invalid_credentials" } }) });
  });

  it("uses the system actor but retains the masked target email for an unknown account", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const response = await POST(requestFor({ email: "unknown@example.test", password: "Password123" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "邮箱或密码错误" });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "00000000-0000-4000-8000-0000000000f0",
      action: "LOGIN_FAILED",
      after: { targetEmail: "u***@example.test", reason: "invalid_credentials" },
    }) });
  });

  it("returns the activation message for PENDING without changing the failure counter", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...activeUser, status: "PENDING" });
    tx.user.findUnique.mockResolvedValue({ id: activeUser.id, status: "PENDING", lockedUntil: null, failedLoginCount: 0 });
    const response = await POST(requestFor({ email: activeUser.email, password: "Password123" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "等待管理员激活" });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: activeUser.id, after: { targetEmail: "p***@example.test", reason: "pending" } }) });
  });

  it("returns the explicit lock message without incrementing or extending the lock", async () => {
    const lockedUntil = new Date(Date.now() + 60_000);
    prismaMock.user.findUnique.mockResolvedValue({ ...activeUser, failedLoginCount: 5, lockedUntil });
    tx.user.findUnique.mockResolvedValue({ status: "ACTIVE", lockedUntil, failedLoginCount: 5 });
    const response = await POST(requestFor({ email: activeUser.email, password: "Password123" }));
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({ error: "账号已锁定，请 15 分钟后重试" });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ after: { targetEmail: "p***@example.test", reason: "locked" } }) });
  });

  it("writes the lock on the fifth failure while returning the generic password error", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    tx.user.findUnique
      .mockResolvedValueOnce({ id: activeUser.id, status: "ACTIVE", lockedUntil: null, failedLoginCount: 4 })
      .mockResolvedValueOnce({ failedLoginCount: 5, lockedUntil: null });
    const response = await POST(requestFor({ email: activeUser.email, password: "WrongPass123" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "邮箱或密码错误" });
    expect(tx.user.updateMany).toHaveBeenNthCalledWith(1, { where: { id: activeUser.id, status: "ACTIVE", lockedUntil: null }, data: { failedLoginCount: { increment: 1 } } });
    expect(tx.user.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: activeUser.id, status: "ACTIVE", lockedUntil: null },
      data: { lockedUntil: expect.any(Date) },
    }));
  });
  it("does not issue a cookie or retry when the audit write fails", async () => {
    tx.auditLog.create.mockRejectedValueOnce(new Error("Synthetic audit failure"));
    const response = await POST(requestFor({ email: activeUser.email, password: "Password123" }));
    expect(response.status).toBe(500);
    expect(setCookieMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });
  it("returns a retryable 503 after bounded conflicts without issuing a cookie", async () => {
    prismaMock.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Synthetic conflict", { code: "P2034", clientVersion: "test" }));
    const response = await POST(requestFor({ email: activeUser.email, password: "Password123" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
    expect(setCookieMock).not.toHaveBeenCalled();
  });
  it("rejects credentials changed while bcrypt was running", async () => {
    tx.user.findUnique.mockResolvedValue({ ...activeUser, passwordHash: "changed-synthetic-hash" });
    const response = await POST(requestFor({ email: activeUser.email, password: "Password123" }));
    expect(response.status).toBe(401);
    expect(tx.session.create).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });
});
