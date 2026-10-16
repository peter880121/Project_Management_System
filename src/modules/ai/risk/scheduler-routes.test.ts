import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ user: vi.fn(), configure: vi.fn(), get: vi.fn(), retry: vi.fn(), list: vi.fn(), read: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocked.user }));
vi.mock("./scheduler-service", async (original) => { const actual = await original<typeof import("./scheduler-service")>(); return { ...actual, configureRiskSchedule: mocked.configure, getRiskSchedule: mocked.get, retryRiskJob: mocked.retry }; });
vi.mock("./notifications", () => ({ getRiskNotifications: mocked.list, readRiskNotification: mocked.read }));
import { PUT } from "@/app/api/projects/[projectId]/risk-schedule/route";
import { GET } from "@/app/api/notifications/route";
import { POST } from "@/app/api/notifications/[id]/read/route";
import { POST as retry } from "@/app/api/risk-jobs/[id]/retry/route";
const id = randomUUID(); const actorId = randomUUID();
const request = (body: unknown) => new Request("http://localhost/api", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocked.user.mockResolvedValue({ id: actorId, role: "PM" }); mocked.configure.mockResolvedValue({ version: 1 }); mocked.list.mockResolvedValue({ data: [], unreadCount: 0 }); mocked.read.mockResolvedValue({ readAt: new Date() }); });
it.each(["ADMIN", "QA", "MEMBER"])("rejects %s schedule/notification access", async (role) => {
  mocked.user.mockResolvedValue({ id: actorId, role });
  expect((await PUT(request({}), { params: Promise.resolve({ projectId: id }) })).status).toBe(403);
  expect((await GET(new Request("http://localhost/api"))).status).toBe(403);
  expect((await retry(new Request("http://localhost/api"), { params: Promise.resolve({ id }) })).status).toBe(403);
});
it("requires authentication for personal notifications", async () => { mocked.user.mockResolvedValue(null); expect((await GET(new Request("http://localhost/api"))).status).toBe(401); });
it("takes recipient identity from the session rather than query parameters", async () => {
  expect((await GET(new Request(`http://localhost/api?userId=${id}`))).status).toBe(200);
  expect(mocked.list).toHaveBeenCalledWith(actorId, 1);
  await POST(new Request("http://localhost/api"), { params: Promise.resolve({ id }) });
  expect(mocked.read).toHaveBeenCalledWith(id, expect.objectContaining({ actorId }));
});
it("validates supported intervals and prevents injecting a scheduler actor", async () => {
  const body = { enabled: true, intervalMinutes: 60, expectedVersion: 0 };
  expect((await PUT(request({ ...body, intervalMinutes: 1 }), { params: Promise.resolve({ projectId: id }) })).status).toBe(400);
  expect((await PUT(request({ ...body, configuredById: id }), { params: Promise.resolve({ projectId: id }) })).status).toBe(400);
  expect((await PUT(request(body), { params: Promise.resolve({ projectId: id }) })).status).toBe(200);
  expect(mocked.configure).toHaveBeenCalledWith(id, body, expect.objectContaining({ actorId }));
});
