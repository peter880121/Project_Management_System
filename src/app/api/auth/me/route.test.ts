import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, prismaMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  prismaMock: { user: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getCurrentUserMock }));

import { GET } from "./route";

const currentUser = { id: "00000000-0000-4000-8000-000000000123", role: "PM" as const };
const safeUser = {
  ...currentUser,
  email: "pm@example.test",
  name: "Synthetic PM",
  status: "ACTIVE",
  lastLoginAt: new Date("2026-10-13T00:00:00.000Z"),
};

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue(currentUser);
    prismaMock.user.findUnique.mockResolvedValue(safeUser);
  });

  it("returns only the current user's safe account fields", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ user: { ...safeUser, lastLoginAt: safeUser.lastLoginAt.toISOString() } });
    expect(JSON.stringify(payload)).not.toContain("passwordHash");
    expect(JSON.stringify(payload)).not.toContain("sessionId");
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: currentUser.id },
      select: { id: true, email: true, name: true, role: true, status: true, lastLoginAt: true },
    });
  });

  it("returns 401 without looking up a user when unauthenticated", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns 401 if the account became inactive before the safe-field lookup", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...safeUser, status: "DISABLED" });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns 401 if the user record no longer exists", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });
});
