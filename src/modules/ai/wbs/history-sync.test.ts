import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), taskFind: vi.fn(), pending: vi.fn(), embed: vi.fn(), upsert: vi.fn(), search: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, task: { findMany: mocks.taskFind }, syncFailure: { findMany: mocks.pending, findFirst: vi.fn() } } }));
vi.mock("@/modules/ai/embeddings", () => ({ embedTaskText: mocks.embed }));
vi.mock("@/modules/vector/task-history", () => ({ searchTaskHistory: mocks.search, upsertTaskHistoryVector: mocks.upsert }));
import { productionHistoryAdapters, retryProjectHistorySync } from "./history";
import { prisma } from "@/lib/prisma";
const tx = { $queryRaw: vi.fn(), syncFailure: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() } };
const task = { id: "task", title: "Synthetic task", description: null, actualHours: 2, deliveryDays: 1 };
describe("durable history sync work", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.embed.mockResolvedValue([0.1]); mocks.upsert.mockResolvedValue(undefined);
  });
  it("persists only missing jobs without embedding or vector calls", async () => {
    tx.syncFailure.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "existing" });
    await productionHistoryAdapters.enqueueFallbacks!([task, { ...task, id: "other" }], "project");
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.syncFailure.create).toHaveBeenCalledOnce();
    expect(tx.syncFailure.create).toHaveBeenCalledWith({ data: expect.objectContaining({ projectId: "project", entityId: "task", target: "MILVUS_TASK_HISTORY" }) });
    expect(mocks.embed).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("removes work only after successful embedding and vector upsert", async () => {
    await productionHistoryAdapters.indexFallbacks!([task], "project");
    expect(mocks.upsert).toHaveBeenCalledWith({ taskId: "task", projectId: "project", embedding: [0.1] });
    expect(tx.syncFailure.deleteMany).toHaveBeenCalledWith({ where: { entityType: "Task", entityId: "task", target: "MILVUS_TASK_HISTORY" } });
  });
  it("retains work and increments failure count when the vector write fails", async () => {
    mocks.upsert.mockRejectedValue(new Error("offline"));
    tx.syncFailure.findFirst.mockResolvedValue({ id: "failure" });
    await productionHistoryAdapters.indexFallbacks!([task], "project");
    expect(tx.syncFailure.deleteMany).not.toHaveBeenCalled();
    expect(tx.syncFailure.update).toHaveBeenCalledWith({ where: { id: "failure" }, data: expect.objectContaining({ retryCount: { increment: 1 } }) });
  });
  it("does not retry exhausted work", async () => {
    vi.mocked(prisma.syncFailure.findFirst).mockResolvedValue({ retryCount: 5 } as never);
    await productionHistoryAdapters.indexFallbacks!([task], "project");
    expect(mocks.embed).not.toHaveBeenCalled();
  });
  it("selects a bounded project-scoped batch for explicit retry", async () => {
    mocks.pending.mockResolvedValue([{ entityId: "task" }]); mocks.taskFind.mockResolvedValue([]);
    expect(await retryProjectHistorySync("project")).toEqual({ attemptedTaskIds: [] });
    expect(mocks.pending).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project", entityType: "Task", target: "MILVUS_TASK_HISTORY", retryCount: { lt: 5 } }, take: 5 }));
  });
});
