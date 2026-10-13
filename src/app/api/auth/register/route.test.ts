import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tx, prismaMock, hashPasswordMock } = vi.hoisted(() => ({
  tx: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  prismaMock: { $transaction: vi.fn() },
  hashPasswordMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/auth/password", () => ({ hashPassword: hashPasswordMock }));

import { POST } from "./route";

const requestFor = (body: unknown) => new Request("http://localhost/api/auth/register", {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.12", "user-agent": "vitest-agent" },
  body: JSON.stringify(body),
});

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REGISTRATION_INVITE_CODE;
    tx.user.findUnique.mockResolvedValue(null);
    tx.user.create.mockImplementation(async ({ data }) => ({ id: "new-user-id", status: data.status }));
    tx.auditLog.create.mockResolvedValue({ id: "audit-id" });
    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));
    hashPasswordMock.mockResolvedValue("$2b$12$synthetic-hash");
  });

  afterEach(() => {
    // Route tests use mocked Prisma, so no database rows are created; reset mocks and env per case.
    vi.clearAllMocks();
    delete process.env.REGISTRATION_INVITE_CODE;
  });

  // Matching curl scenario: POST valid registration without inviteCode.
  it("registers without an invite as PENDING and does not create a session", async () => {
    const response = await POST(requestFor({ name: "Synthetic User", email: "User@example.test", password: "Password123" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ message: "注册成功，等待管理员激活", status: "PENDING" });
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: "user@example.test", status: "PENDING" }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: "new-user-id", action: "USER_REGISTERED" }) }));
  });

  // Matching curl scenario: POST valid registration with configured REGISTRATION_INVITE_CODE.
  it("registers with the configured invite as ACTIVE", async () => {
    process.env.REGISTRATION_INVITE_CODE = "synthetic-invite";
    const response = await POST(requestFor({ name: "Synthetic User", email: "user@example.test", password: "Password123", inviteCode: "synthetic-invite" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ message: "注册成功，请登录", status: "ACTIVE" });
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE" }) }));
  });

  // Matching curl scenario: POST with inviteCode that differs from configured value.
  it("rejects an invalid invite explicitly", async () => {
    process.env.REGISTRATION_INVITE_CODE = "synthetic-invite";
    const response = await POST(requestFor({ name: "Synthetic User", email: "user@example.test", password: "Password123", inviteCode: "wrong-invite" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "邀请码无效" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // Matching curl scenario: POST an email already returned by the database lookup.
  it("returns the generic error and audits a duplicate-email rejection as a system event", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "existing-user-id" });
    const response = await POST(requestFor({ name: "Synthetic User", email: "user@example.test", password: "Password123" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "无法完成注册" });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "00000000-0000-4000-8000-0000000000f0",
      action: "USER_REGISTRATION_REJECTED",
      entityType: "RegistrationAttempt",
      after: { email: "u***@example.test", reason: "duplicate_email" },
      ip: "192.0.2.12",
      userAgent: "vitest-agent",
    }) });
  });

  // Matching curl scenario: POST a password over bcrypt's 72-byte UTF-8 limit.
  it("returns 400 for a password over 72 UTF-8 bytes", async () => {
    hashPasswordMock.mockRejectedValue(new RangeError("too long"));
    const response = await POST(requestFor({ name: "Synthetic User", email: "user@example.test", password: `${"中".repeat(25)}A1` }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "密码不能超过 72 字节" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // Matching curl scenario: POST a password missing either letters or digits / shorter than 8.
  it("returns 400 when the password does not meet format rules", async () => {
    const response = await POST(requestFor({ name: "Synthetic User", email: "user@example.test", password: "allletters" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "密码至少 8 位，且必须包含字母和数字" });
    expect(hashPasswordMock).not.toHaveBeenCalled();
  });

  // Matching curl scenario: POST with malformed email.
  it("returns 400 when the email format is invalid", async () => {
    const response = await POST(requestFor({ name: "Synthetic User", email: "not-an-email", password: "Password123" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "邮箱格式不正确" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
