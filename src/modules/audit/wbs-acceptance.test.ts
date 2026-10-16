import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  project: vi.fn(), suggestion: vi.fn(), dependencies: vi.fn(), createTask: vi.fn(), transaction: vi.fn(), actor: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { aiSuggestion: { findUnique: mocks.project }, $transaction: mocks.transaction } }));
vi.mock("@/modules/auth/project-access", () => ({ lockBusinessActor: mocks.actor, assertProjectAccessTx: vi.fn(), participant: vi.fn(), ProjectAccessError: class extends Error {} }));
import { acceptWbsSuggestion } from "./service";

describe("WBS acceptance prerequisite guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.project.mockResolvedValue({ projectId: "synthetic-project" });
    mocks.suggestion.mockResolvedValue({ id: "synthetic-suggestion", projectId: "synthetic-project", type: "WBS", status: "PENDING", output: {
      title: "Synthetic validation", description: "Synthetic acceptance task", estimateHours: 4, suggestedRole: "QA",
      dependencyIds: ["00000000-0000-4000-8000-000000000999"], dependencyTitles: ["Synthetic design"],
    } });
    mocks.transaction.mockImplementation(async callback => callback({ aiSuggestion: { findUnique: mocks.suggestion, findMany: mocks.dependencies }, task: { create: mocks.createTask } }));
  });
  it.each(["PENDING", "REJECTED"])("blocks %s prerequisites with an actionable Chinese error before creating a task", async status => {
    mocks.dependencies.mockResolvedValue([{ id: "00000000-0000-4000-8000-000000000999", status, output: { title: "Synthetic design" } }]);
    await expect(acceptWbsSuggestion({ suggestionId: "synthetic-suggestion", actorId: "synthetic-pm" })).rejects.toThrow(status === "PENDING" ? "请先采纳前置任务：《Synthetic design》" : "前置任务已拒绝或不可用");
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
  it("blocks missing prerequisites without creating an orphan task", async () => {
    mocks.dependencies.mockResolvedValue([]);
    await expect(acceptWbsSuggestion({ suggestionId: "synthetic-suggestion", actorId: "synthetic-pm" })).rejects.toThrow("前置任务已拒绝或不可用");
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
