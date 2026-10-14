import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, listUsers, createUser } = vi.hoisted(() => ({ getUser: vi.fn(), listUsers: vi.fn(), createUser: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getUser }));
vi.mock("@/modules/users/repositories", () => ({ listManagedUsers: listUsers }));
vi.mock("@/modules/users/services", async (importOriginal) => ({ ...await importOriginal<typeof import("@/modules/users/services")>(), createUserByAdmin: createUser }));
import { GET, POST } from "./route";
const request = (query = "") => new Request(`http://localhost/api/users${query}`);
describe("GET users permissions", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([null, "PM", "MEMBER", "QA"])("rejects %s", async (role) => {
    getUser.mockResolvedValue(role ? { id: "actor", role } : null);
    expect((await GET(request())).status).toBe(role ? 403 : 401);
    expect((await POST(new Request("http://localhost/api/users", { method: "POST", body: "{}" }))).status).toBe(role ? 403 : 401);
    expect(listUsers).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });
  it("allows ADMIN", async () => {
    getUser.mockResolvedValue({ id: "actor", role: "ADMIN" });
    listUsers.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });
    expect((await GET(request())).status).toBe(200);
    expect(listUsers).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });
  it.each(["?page=0", "?pageSize=101", "?role=ROOT", "?page=1&page=2", "?isSystem=true"])("rejects invalid query %s", async (query) => {
    getUser.mockResolvedValue({ id: "actor", role: "ADMIN" });
    expect((await GET(request(query))).status).toBe(400);
    expect(listUsers).not.toHaveBeenCalled();
  });
  it("rejects malformed and extra create fields without invoking writes", async () => {
    getUser.mockResolvedValue({ id: "actor", role: "ADMIN" });
    for (const body of ["invalid-json", JSON.stringify({ name: "User", email: "user@example.test", role: "MEMBER", initialPassword: "Password123", status: "DISABLED" })]) {
      expect((await POST(new Request("http://localhost/api/users", { method: "POST", body }))).status).toBe(400);
    }
    expect(createUser).not.toHaveBeenCalled();
  });
  it("creates with authenticated actor and audit metadata", async () => {
    getUser.mockResolvedValue({ id: "actor", role: "ADMIN" });
    createUser.mockResolvedValue({ id: "new", role: "MEMBER", status: "ACTIVE" });
    const response = await POST(new Request("http://localhost/api/users", { method: "POST", headers: { "x-real-ip": "192.0.2.30", "user-agent": "unit" }, body: JSON.stringify({ name: " Synthetic ", email: " USER@example.test ", role: "MEMBER", initialPassword: "Password123" }) }));
    expect(response.status).toBe(201);
    expect(createUser).toHaveBeenCalledWith({ actorId: "actor", name: "Synthetic", email: "user@example.test", role: "MEMBER", initialPassword: "Password123", ip: "192.0.2.30", userAgent: "unit" });
  });
});
