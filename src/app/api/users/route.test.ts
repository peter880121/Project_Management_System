import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, findMany } = vi.hoisted(() => ({ getUser: vi.fn(), findMany: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany } } }));
import { GET } from "./route";
describe("GET users permissions", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([null, "PM", "MEMBER", "QA"])("rejects %s", async (role) => {
    getUser.mockResolvedValue(role ? { id: "actor", role } : null);
    expect((await GET()).status).toBe(role ? 403 : 401);
    expect(findMany).not.toHaveBeenCalled();
  });
  it("allows ADMIN", async () => {
    getUser.mockResolvedValue({ id: "actor", role: "ADMIN" });
    findMany.mockResolvedValue([]);
    expect((await GET()).status).toBe(200);
  });
});
