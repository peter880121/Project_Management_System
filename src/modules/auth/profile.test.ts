import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique } } }));
import { getProfileForUser } from "./profile";

describe("profile lookup", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("selects only safe fields for the authenticated user's ID", async () => {
    const user = { id: "verified-user", email: "synthetic@medpm.local", name: "Synthetic", role: "MEMBER", status: "ACTIVE", lastLoginAt: null };
    findUnique.mockResolvedValue(user);
    expect(await getProfileForUser(user.id)).toEqual(user);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: user.id },
      select: { id: true, email: true, name: true, role: true, status: true, lastLoginAt: true },
    });
  });
  it("returns null for a missing user", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getProfileForUser("missing-user")).toBeNull();
  });
  it("propagates database failures instead of treating them as missing users", async () => {
    findUnique.mockRejectedValue(new Error("database unavailable"));
    await expect(getProfileForUser("verified-user")).rejects.toThrow("database unavailable");
  });
});
