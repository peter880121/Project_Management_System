import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, findMany } = vi.hoisted(() => ({ getUser: vi.fn(), findMany: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany } } }));
import { GET } from "./route";

describe("GET user options", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each(["ADMIN", "PM"])("allows %s and selects exactly the permitted fields", async (role) => {
    getUser.mockResolvedValue({ id: "actor", role });
    findMany.mockResolvedValue([{ id: "member", name: "Synthetic", email: "synthetic@medpm.local" }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ id: "member", name: "Synthetic", email: "synthetic@medpm.local" }] });
    expect(findMany).toHaveBeenCalledWith({
      where: { isSystem: false, status: "ACTIVE" }, select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  });
  it.each([null, "MEMBER", "QA"])("rejects %s before querying", async (role) => {
    getUser.mockResolvedValue(role ? { id: "actor", role } : null);
    expect((await GET()).status).toBe(role ? 403 : 401);
    expect(findMany).not.toHaveBeenCalled();
  });
  it("reports database failure without pretending the list is empty", async () => {
    getUser.mockResolvedValue({ id: "actor", role: "PM" });
    findMany.mockRejectedValue(new Error("database down"));
    expect((await GET()).status).toBe(500);
  });
});
