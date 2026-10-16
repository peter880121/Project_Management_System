import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), project: vi.fn(), transaction: vi.fn(), audit: vi.fn(), retry: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocks.actor }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findUnique: mocks.project }, $transaction: mocks.transaction } }));
vi.mock("@/modules/audit/service", () => ({ recordAudit: mocks.audit }));
vi.mock("@/modules/ai/wbs/history", () => ({ retryProjectHistorySync: mocks.retry }));
import { POST } from "./route";
const id = "00000000-0000-4000-8000-000000000065";
const context = { params: Promise.resolve({ projectId: id }) };
const request = new Request("http://localhost/history-sync", { method: "POST" });
describe("explicit history synchronization", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.actor.mockResolvedValue({ id, role: "PM" });
    mocks.project.mockResolvedValue({ id }); mocks.transaction.mockImplementation((callback) => callback("tx"));
    mocks.retry.mockResolvedValue({ attemptedTaskIds: [] });
  });
  it.each([null, "QA", "MEMBER", "ADMIN"])("rejects %s before retrying", async (role) => {
    mocks.actor.mockResolvedValue(role ? { id, role } : null);
    expect((await POST(request, context)).status).toBe(role ? 403 : 401);
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("rejects an invalid or missing project", async () => {
    expect((await POST(request, { params: Promise.resolve({ projectId: "invalid" }) })).status).toBe(400);
    mocks.project.mockResolvedValue(null);
    expect((await POST(request, context)).status).toBe(404);
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("audits the authorized retry before doing remote work", async () => {
    expect((await POST(request, context)).status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith("tx", expect.objectContaining({ actorId: id, projectId: id, action: "VECTOR_SYNC_RETRIED" }));
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.retry.mock.invocationCallOrder[0]);
  });
  it("prevents untracked retry when audit fails", async () => {
    mocks.audit.mockRejectedValue(new Error("audit offline"));
    expect((await POST(request, context)).status).toBe(500);
    expect(mocks.retry).not.toHaveBeenCalled();
  });
});
