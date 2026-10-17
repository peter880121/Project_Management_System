import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), scan: vi.fn(), list: vi.fn(), detail: vi.fn(), summary: vi.fn(), finding: vi.fn(), version: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocks.actor }));
vi.mock("./service", () => ({ runComplianceAudit: mocks.scan }));
vi.mock("./repositories", () => ({ listSummaries: mocks.list, summaryDetail: mocks.detail }));
vi.mock("./review-service", async (original) => ({ ...await original<typeof import("./review-service")>(), reviewSummary: mocks.summary, reviewFinding: mocks.finding, reviewRequirementVersion: mocks.version }));
import { POST as scan } from "@/app/api/audit/summary/route";
import { GET as list } from "@/app/api/audit/summaries/route";
import { PATCH as decide } from "@/app/api/audit/summaries/[suggestionId]/route";
import { POST as version } from "@/app/api/projects/[projectId]/compliance/requirement-reviews/route";
import { POST as finding } from "@/app/api/audit/summaries/[suggestionId]/findings/[findingKey]/review/route";
const id = "00000000-0000-4000-8000-000000000001";
const request = (body: unknown) => new Request(`http://localhost/api/audit/summaries?projectId=${id}`, { method: "POST", body: JSON.stringify(body) });
describe("compliance API authorization and validation", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.scan.mockResolvedValue({ status: "PENDING" }); mocks.list.mockResolvedValue([]); mocks.summary.mockResolvedValue({ status: "ACCEPTED" }); });
  it.each([null, "PM", "MEMBER"])("denies %s scan and history access", async (role) => {
    mocks.actor.mockResolvedValue(role ? { id, role } : null);
    expect((await scan(request({ projectId: id }))).status).toBe(role ? 403 : 401);
    expect((await list(request({}))).status).toBe(role ? 403 : 401);
    expect(mocks.scan).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each(["QA", "ADMIN"])("allows %s scan/history", async (role) => {
    mocks.actor.mockResolvedValue({ id, role });
    expect((await scan(request({ projectId: id }))).status).toBe(200);
    expect((await list(request({}))).status).toBe(200);
  });
  it("permits PM only in task scope, never project scope or formal review", async () => {
    mocks.actor.mockResolvedValue({ id, role: "PM" });
    expect((await scan(request({ projectId: id, taskId: id }))).status).toBe(200);
    expect(mocks.scan).toHaveBeenCalledWith(expect.objectContaining({ taskId: id, actorId: id }));
    expect((await scan(request({ projectId: id, taskId: id, actorId: id }))).status).toBe(403);
    expect((await scan(request({ projectId: id }))).status).toBe(403);
  });
  it.each(["PM", "MEMBER", "ADMIN"])("denies %s summary and version/finding review", async (role) => {
    mocks.actor.mockResolvedValue({ id, role });
    expect((await decide(request({ decision: "ACCEPTED", note: "Synthetic" }), { params: Promise.resolve({ suggestionId: id }) })).status).toBe(403);
    expect((await version(request({}), { params: Promise.resolve({ projectId: id }) })).status).toBe(403);
    expect((await finding(request({}), { params: Promise.resolve({ suggestionId: id, findingKey: `TASK_WITHOUT_REQUIREMENT:${id}:0` }) })).status).toBe(403);
    expect(mocks.summary).not.toHaveBeenCalled(); expect(mocks.version).not.toHaveBeenCalled(); expect(mocks.finding).not.toHaveBeenCalled();
  });
  it("requires QA explanation and validates IDs/concurrency data before writes", async () => {
    mocks.actor.mockResolvedValue({ id, role: "QA" });
    expect((await decide(request({ decision: "ACCEPTED", note: " " }), { params: Promise.resolve({ suggestionId: id }) })).status).toBe(400);
    expect((await version(request({}), { params: Promise.resolve({ projectId: "bad" }) })).status).toBe(400);
    expect((await decide(request({ decision: "ACCEPTED", note: "Synthetic review" }), { params: Promise.resolve({ suggestionId: id }) })).status).toBe(200);
  });
});
// These tests isolate role/validation behavior; project scope is exercised separately.
vi.mock("@/modules/auth/project-scope-http", () => ({ projectScoped: (handler: unknown) => handler }));
