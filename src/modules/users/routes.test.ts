import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, roleChange, statusChange } = vi.hoisted(() => ({ getUser: vi.fn(), roleChange: vi.fn(), statusChange: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getUser }));
vi.mock("./services", async (importOriginal) => ({ ...await importOriginal<typeof import("./services")>(), changeManagedUserRole: roleChange, changeManagedUserStatus: statusChange }));
import { PATCH as rolePatch } from "@/app/api/users/[id]/role/route";
import { PATCH as statusPatch } from "@/app/api/users/[id]/status/route";
import { UserManagementError } from "./services";
const id = "00000000-0000-4000-8000-000000000123";
const context = { params: Promise.resolve({ id }) };
const request = (body: unknown) => new Request("http://localhost/api/users/target", { method: "PATCH", body: JSON.stringify(body) });
describe("role and status handlers", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([null, "PM", "MEMBER", "QA"])("rejects actor %s", async (role) => {
    getUser.mockResolvedValue(role ? { id: "actor", role } : null);
    expect((await rolePatch(request({ role: "QA" }), context)).status).toBe(role ? 403 : 401);
    expect((await statusPatch(request({ status: "ACTIVE" }), context)).status).toBe(role ? 403 : 401);
    expect(roleChange).not.toHaveBeenCalled(); expect(statusChange).not.toHaveBeenCalled();
  });
  it("rejects invalid IDs, roles and statuses", async () => {
    getUser.mockResolvedValue({ id: "actor", role: "ADMIN" });
    expect((await rolePatch(request({ role: "ROOT" }), context)).status).toBe(400);
    expect((await statusPatch(request({ status: "PENDING" }), context)).status).toBe(400);
    expect((await statusPatch(request({ status: "ACTIVE" }), { params: Promise.resolve({ id: "bad" }) })).status).toBe(400);
  });
  it("maps service conflicts to 409 with the required message", async () => {
    getUser.mockResolvedValue({ id: "actor", role: "ADMIN" });
    statusChange.mockRejectedValue(new UserManagementError(409, "账号状态已变化，请刷新"));
    const response = await statusPatch(request({ status: "DISABLED" }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "账号状态已变化，请刷新" });
  });
});
