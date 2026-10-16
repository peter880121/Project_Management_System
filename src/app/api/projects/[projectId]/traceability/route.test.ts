import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), save: vi.fn(), load: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocks.actor }));
vi.mock("@/modules/projects/services", () => ({ saveTraceability: mocks.save, ProjectError: class extends Error {} }));
vi.mock("@/modules/projects/repositories", () => ({ loadTraceability: mocks.load }));
import { GET, POST, PATCH } from "./route";

const id = "00000000-0000-4000-8000-000000000065";
const context = { params: Promise.resolve({ projectId: id }) };
const requirement = { kind: "requirement", title: "Synthetic", content: "Synthetic criteria", status: "DRAFT" };
const request = (body: unknown) => new Request("http://localhost/api/projects/traceability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
describe("traceability authorization and validation", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.save.mockResolvedValue({ id }); });
  it.each([null, "MEMBER", "ADMIN"])("rejects writes by %s", async (role) => {
    mocks.actor.mockResolvedValue(role ? { id, role } : null);
    expect((await POST(request(requirement), context)).status).toBe(role ? 403 : 401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("allows PM requirement creation with actor and request metadata", async () => {
    mocks.actor.mockResolvedValue({ id, role: "PM" });
    expect((await POST(request(requirement), context)).status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith(id, requirement, expect.objectContaining({ actorId: id }));
  });
  it("denies QA edits to requirements and PM edits to test cases", async () => {
    mocks.actor.mockResolvedValue({ id, role: "QA" });
    expect((await POST(request(requirement), context)).status).toBe(403);
    mocks.actor.mockResolvedValue({ id, role: "PM" });
    expect((await POST(request({ kind: "testCase", requirementId: id, title: "Synthetic", status: "PASSED" }), context)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("allows QA test result updates", async () => {
    mocks.actor.mockResolvedValue({ id, role: "QA" });
    expect((await PATCH(request({ kind: "testCase", id, title: "Synthetic", status: "PASSED", expectedUpdatedAt: "2026-10-15T00:00:00.000Z" }), context)).status).toBe(200);
  });
  it("rejects invalid UUIDs, unknown fields and missing concurrency tokens", async () => {
    mocks.actor.mockResolvedValue({ id, role: "PM" });
    expect((await POST(request(requirement), { params: Promise.resolve({ projectId: "bad" }) })).status).toBe(400);
    expect((await POST(request({ ...requirement, projectId: id }), context)).status).toBe(400);
    expect((await PATCH(request({ ...requirement, id }), context)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns 404 for a missing project and allows member reads", async () => {
    mocks.actor.mockResolvedValue({ id, role: "MEMBER" }); mocks.load.mockResolvedValue(null);
    expect((await GET(request({}), context)).status).toBe(404);
    mocks.load.mockResolvedValue({ requirements: [], tasks: [] });
    expect((await GET(request({}), context)).status).toBe(200);
  });
});
