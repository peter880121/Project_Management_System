import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), create: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocks.actor }));
vi.mock("@/modules/projects/services", () => ({ createProject: mocks.create, ProjectError: class extends Error {} }));
import { POST } from "./route";
const request = (body: unknown) => new Request("http://localhost/api/projects", { method: "POST", body: JSON.stringify(body) });
describe("project creation", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it.each([null, "ADMIN", "QA", "MEMBER"])("rejects %s before writing", async (role) => {
    mocks.actor.mockResolvedValue(role ? { id: "actor", role } : null);
    expect((await POST(request({ name: "Synthetic" }))).status).toBe(role ? 403 : 401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("trims PM input and rejects unknown fields", async () => {
    mocks.actor.mockResolvedValue({ id: "actor", role: "PM" }); mocks.create.mockResolvedValue({ id: "project" });
    expect((await POST(request({ name: " Synthetic " }))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ name: "Synthetic", description: "", initializeStandardTasks: true }, expect.objectContaining({ actorId: "actor" }));
    expect((await POST(request({ name: " " }))).status).toBe(400);
    expect((await POST(request({ name: "Synthetic", ownerId: "other" }))).status).toBe(400);
  });
});
