import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@zilliz/milvus2-sdk-node", () => ({ MilvusClient: mock.create }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); mock.create.mockReset(); });
it("handles the SDK's independent initialization rejection and allows recovery", async () => {
  vi.stubEnv("MILVUS_ADDRESS", "127.0.0.1:19530");
  let reject!: (reason: Error) => void;
  const failed = { connectPromise: new Promise<void>((_, fail) => { reject = fail; }), closeConnection: vi.fn().mockResolvedValue(undefined) };
  const recovered = { connectPromise: Promise.resolve(), closeConnection: vi.fn() };
  mock.create.mockImplementationOnce(function () { return failed; }).mockImplementationOnce(function () { return recovered; });
  const { getMilvusClient } = await import("./client");
  expect(getMilvusClient()).toBe(failed);
  reject(new Error("synthetic unavailable")); await Promise.resolve(); await Promise.resolve();
  expect(failed.closeConnection).toHaveBeenCalledOnce(); expect(getMilvusClient()).toBe(recovered);
  expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 5000, logLevel: "error" }));
});
