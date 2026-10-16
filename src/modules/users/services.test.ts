import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), identity: vi.fn(), create: vi.fn(), role: vi.fn(), status: vi.fn(), revoke: vi.fn(), audit: vi.fn(), hash: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/modules/auth/password", () => ({ hashPassword: mocks.hash }));
vi.mock("@/modules/audit/service", () => ({ recordAudit: mocks.audit }));
vi.mock("./repositories", () => ({ lockUsers: mocks.lock, findManagementIdentity: mocks.identity, createManagedUser: mocks.create, updateManagedRole: mocks.role, updateManagedStatus: mocks.status, revokeActiveSessions: mocks.revoke }));
import { changeManagedUserRole, changeManagedUserStatus, createUserByAdmin } from "./services";

const actor = { id: "actor", role: "ADMIN", status: "ACTIVE", isSystem: false };
const target = { id: "target", role: "MEMBER", status: "ACTIVE", isSystem: false };
describe("audited user management services", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation((callback) => callback("tx"));
    mocks.identity.mockImplementation((_tx, id) => Promise.resolve(id === actor.id ? actor : target));
    mocks.role.mockResolvedValue({ count: 1 });
    mocks.status.mockResolvedValue({ count: 1 });
    mocks.revoke.mockResolvedValue({ count: 3 });
    mocks.hash.mockResolvedValue("synthetic-hash");
  });
  it("audits only the affected active-session count", async () => {
    await changeManagedUserStatus({ actorId: actor.id, userId: target.id, status: "DISABLED" });
    expect(mocks.lock).toHaveBeenCalledWith("tx", [actor.id, target.id]);
    expect(mocks.audit).toHaveBeenCalledWith("tx", expect.objectContaining({ before: { status: "ACTIVE" }, after: { status: "DISABLED", revokedActiveSessionCount: 3 } }));
  });
  it("activates pending users without restoring sessions", async () => {
    mocks.identity.mockImplementation((_tx, id) => Promise.resolve(id === actor.id ? actor : { ...target, status: "PENDING" }));
    await changeManagedUserStatus({ actorId: actor.id, userId: target.id, status: "ACTIVE" });
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith("tx", expect.objectContaining({ before: { status: "PENDING" }, after: { status: "ACTIVE", revokedActiveSessionCount: 0 } }));
  });
  it.each(["ACTIVE", "DISABLED"])("rejects an already-current status %s", async (status) => {
    mocks.identity.mockImplementation((_tx, id) => Promise.resolve(id === actor.id ? actor : { ...target, status }));
    await expect(changeManagedUserStatus({ actorId: actor.id, userId: target.id, status: status as "ACTIVE" | "DISABLED" })).rejects.toMatchObject({ status: 409, message: "账号状态已变化，请刷新" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects a lost conditional write without creating audit", async () => {
    mocks.status.mockResolvedValue({ count: 0 });
    await expect(changeManagedUserStatus({ actorId: actor.id, userId: target.id, status: "DISABLED" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rechecks actor permissions inside the transaction", async () => {
    mocks.identity.mockResolvedValue({ ...actor, role: "PM" });
    await expect(changeManagedUserRole({ actorId: actor.id, userId: target.id, role: "QA" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.role).not.toHaveBeenCalled();
  });
  it("rejects self and system changes", async () => {
    await expect(changeManagedUserStatus({ actorId: actor.id, userId: actor.id, status: "DISABLED" })).rejects.toMatchObject({ status: 403 });
    mocks.identity.mockImplementation((_tx, id) => Promise.resolve(id === actor.id ? actor : { ...target, isSystem: true }));
    await expect(changeManagedUserRole({ actorId: actor.id, userId: target.id, role: "QA" })).rejects.toMatchObject({ status: 403 });
  });
  it("rejects self changes through a differently cased identifier resolving to the same account", async () => {
    mocks.identity.mockResolvedValue(actor);
    await expect(changeManagedUserRole({ actorId: actor.id, userId: actor.id.toUpperCase(), role: "QA" })).rejects.toMatchObject({ status: 403 });
    await expect(changeManagedUserStatus({ actorId: actor.id, userId: actor.id.toUpperCase(), status: "DISABLED" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("records before/after role without returning sensitive fields", async () => {
    expect(await changeManagedUserRole({ actorId: actor.id, userId: target.id, role: "QA" })).toEqual({ id: target.id, role: "QA" });
    expect(mocks.audit).toHaveBeenCalledWith("tx", expect.objectContaining({ action: "PERMISSION_CHANGED", before: { role: "MEMBER" }, after: { role: "QA" } }));
  });
  it("creates using a hash and records no password material", async () => {
    mocks.create.mockResolvedValue({ ...target, email: "synthetic@example.test" });
    await createUserByAdmin({ actorId: actor.id, name: "Synthetic", email: "synthetic@example.test", role: "MEMBER", initialPassword: "Password123" });
    expect(mocks.create).toHaveBeenCalledWith("tx", expect.objectContaining({ passwordHash: "synthetic-hash" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("synthetic-hash");
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("Password123");
  });
  it("propagates audit errors to roll back the transaction", async () => {
    mocks.audit.mockRejectedValue(new Error("audit failed"));
    await expect(changeManagedUserStatus({ actorId: actor.id, userId: target.id, status: "DISABLED" })).rejects.toThrow("audit failed");
  });
});
