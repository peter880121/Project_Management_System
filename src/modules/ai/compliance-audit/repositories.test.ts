import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), project: vi.fn(), tasks: vi.fn(), requirements: vi.fn(), cases: vi.fn(), logs: vi.fn(), source: vi.fn() }));
vi.mock("../task-context", () => ({ loadAiTask: mocks.source }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
import { loadComplianceSnapshot } from "./repositories";
const tx = { project: { findUnique: mocks.project }, task: { findMany: mocks.tasks }, requirement: { findMany: mocks.requirements }, testCase: { findMany: mocks.cases }, auditLog: { findMany: mocks.logs }, requirementTaskLink: { findMany: vi.fn() } };
describe("bounded compliance snapshots", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.transaction.mockImplementation((callback) => callback(tx));
    tx.requirementTaskLink.findMany.mockResolvedValue([]);
    mocks.project.mockResolvedValue({ id: "project" }); mocks.tasks.mockResolvedValue([]); mocks.requirements.mockResolvedValue([]); mocks.cases.mockResolvedValue([]); mocks.logs.mockResolvedValue([]);
  });
  it("pages business entities inside a consistent transaction and flags incomplete coverage", async () => {
    mocks.tasks.mockImplementation(({ cursor }) => {
      const start = cursor ? Number(cursor.id) + 1 : 0;
      return Promise.resolve(Array.from({ length: Math.min(200, 5001 - start) }, (_, index) => ({ id: String(start + index) })));
    });
    const result = await loadComplianceSnapshot({ projectId: "project" });
    expect(result.coverage).toMatchObject({ complete: false, tasks: 5000 });
    expect(mocks.tasks).toHaveBeenCalledTimes(26);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 30000 });
  });
  it("reports audit truncation and applies actor/time filters only to source events", async () => {
    mocks.logs.mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({ id: String(index) })));
    const from = new Date("2026-01-01");
    const result = await loadComplianceSnapshot({ projectId: "project", actorFilter: "actor", from });
    expect(result.coverage).toMatchObject({ complete: true, auditLogsTruncated: true, auditLogs: 100 });
    expect(mocks.logs).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project", actorId: "actor", createdAt: { gte: from } } }));
    expect(mocks.tasks).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project" } }));
  });
  it("rejects nonexistent projects before loading business data", async () => {
    mocks.project.mockResolvedValue(null);
    await expect(loadComplianceSnapshot({ projectId: "missing" })).rejects.toMatchObject({ status: 404 });
    expect(mocks.tasks).not.toHaveBeenCalled();
  });
  it("restricts task scans at the database query boundary before model invocation", async () => {
    mocks.source.mockResolvedValue({ id: "task", requirement: { id: "requirement" } });
    mocks.tasks.mockResolvedValue([{ id: "task" }]); mocks.requirements.mockResolvedValue([{ id: "requirement" }]); mocks.cases.mockResolvedValue([{ id: "case" }]);
    await loadComplianceSnapshot({ projectId: "project", taskId: "task" });
    expect(mocks.tasks).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project", id: "task" } }));
    expect(mocks.requirements).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project", id: { in: ["requirement"] } } }));
    expect(mocks.cases).toHaveBeenCalledWith(expect.objectContaining({ where: { requirement: { projectId: "project" }, requirementId: { in: ["requirement"] } } }));
    expect(mocks.logs).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project", entityId: { in: ["task", "requirement", "case"] } } }));
  });
});
