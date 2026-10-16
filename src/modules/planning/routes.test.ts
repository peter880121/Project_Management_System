import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), schedule: vi.fn(), capacity: vi.fn(), read: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("./services", () => ({ updateTaskSchedule: mocks.schedule, updateMemberCapacity: mocks.capacity, getProjectPlanning: mocks.read }));
import { PATCH } from "@/app/api/tasks/[taskId]/schedule/route";
import { PUT } from "@/app/api/users/[id]/capacity/route";
import { GET } from "@/app/api/projects/[projectId]/planning/route";
const id = randomUUID(); const actorId = randomUUID();
const body = { expectedVersion: 0, plannedStartDate: "2026-10-12", dueDate: "2026-10-18", estimateHours: 30, dependencyIds: [] };
const request = (value: unknown) => new Request("http://localhost/api", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: actorId, role: "PM" }); mocks.schedule.mockResolvedValue({ scheduleVersion: 1 }); mocks.capacity.mockResolvedValue({ version: 1 }); mocks.read.mockResolvedValue({ tasks: [], loads: [], members: [] }); });
it.each(["ADMIN", "QA", "MEMBER"])("denies %s planning/capacity writes", async (role) => {
  mocks.user.mockResolvedValue({ id: actorId, role });
  expect((await PATCH(request(body), { params: Promise.resolve({ taskId: id }) })).status).toBe(403);
  expect((await PUT(request({}), { params: Promise.resolve({ id }) })).status).toBe(403);
  expect(mocks.schedule).not.toHaveBeenCalled(); expect(mocks.capacity).not.toHaveBeenCalled();
});
it("requires authentication for reads", async () => { mocks.user.mockResolvedValue(null); expect((await GET(new Request("http://localhost/api"), { params: Promise.resolve({ projectId: id }) })).status).toBe(401); });
it("allows QA to inspect the selected week's snapshot", async () => {
  mocks.user.mockResolvedValue({ id: actorId, role: "QA" });
  expect((await GET(new Request("http://localhost/api?weekStart=2026-10-12"), { params: Promise.resolve({ projectId: id }) })).status).toBe(200);
  expect(mocks.read).toHaveBeenCalledWith(id, new Date("2026-10-12T00:00:00.000Z"));
});
it("rejects malformed dates, hour precision and non-Monday capacity", async () => {
  expect((await PATCH(request({ ...body, plannedStartDate: "2026-02-30" }), { params: Promise.resolve({ taskId: id }) })).status).toBe(400);
  expect((await PATCH(request({ ...body, estimateHours: 1.001 }), { params: Promise.resolve({ taskId: id }) })).status).toBe(400);
  expect((await PUT(request({ weekStart: "2026-10-13", hours: 40, expectedVersion: 0 }), { params: Promise.resolve({ id }) })).status).toBe(400);
  expect(mocks.schedule).not.toHaveBeenCalled(); expect(mocks.capacity).not.toHaveBeenCalled();
});
it("passes validated PM writes and metadata to the transactional service", async () => {
  expect((await PATCH(request(body), { params: Promise.resolve({ taskId: id }) })).status).toBe(200);
  expect(mocks.schedule).toHaveBeenCalledWith(id, body, expect.objectContaining({ actorId }));
});
it("returns infrastructure errors instead of reporting successful unaudited updates", async () => {
  mocks.schedule.mockRejectedValue(new Error("synthetic audit failure"));
  expect((await PATCH(request(body), { params: Promise.resolve({ taskId: id }) })).status).toBe(500);
});
