import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), create: vi.fn(), transaction: vi.fn(), audit: vi.fn(), rag: vi.fn(), configured: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/modules/auth/project-access", () => ({ lockBusinessActor: vi.fn() }));
vi.mock("@/modules/audit/service", () => ({ recordAudit: mocks.audit, recordRagSearch: mocks.rag }));
vi.mock("@/modules/ai/chat-model", () => ({ getConfiguredLlm: mocks.configured }));
vi.mock("./history", () => ({ retrieveHistoricalTasks: async () => ({ tasks: [], hitIds: [], durationMs: 1, degraded: false }) }));
vi.mock("@/modules/documents/rag-service", () => ({ searchProjectDocuments: async () => ({ hits: [], hitIds: [], degraded: false, mode: "VECTOR", durationMs: 1 }) }));
import { generateWbsSuggestions } from "./service";

const valid = JSON.stringify({ tasks: [{ title: "Synthetic login", description: "Synthetic validation", estimateHours: 4, dependencies: [], suggestedRole: "QA", sourceChunkIds: [] }] });
describe("bounded WBS generation and failure diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.invoke.mockReset();
    mocks.configured.mockReturnValue({ model: { invoke: mocks.invoke }, provider: "openai", modelName: "synthetic-chat" });
    mocks.create.mockImplementation(async ({ data }) => data);
    mocks.transaction.mockImplementation(async callback => callback({ aiSuggestion: { create: mocks.create } }));
  });
  it("corrects invalid model output once and only persists pending suggestions", async () => {
    mocks.invoke.mockResolvedValueOnce({ content: '{"tasks":[{"estimateHours":"four hours"}]}' }).mockResolvedValueOnce({ content: valid });
    const result = await generateWbsSuggestions({ projectId: "synthetic-project", actorId: "synthetic-pm", request: "Synthetic login acceptance" });
    expect(result.manualFallback).toBe(false); expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.configured).toHaveBeenCalledWith({ jsonMode: true });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", input: expect.objectContaining({ correctionAttempts: 1 }) }) }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "AI_WBS_GENERATED" }));
  });
  it("stops after two invalid responses and records a safe failure code without writing suggestions", async () => {
    mocks.invoke.mockResolvedValue({ content: "Invalid model prose" });
    const result = await generateWbsSuggestions({ projectId: "synthetic-project", actorId: "synthetic-pm", request: "Synthetic login acceptance" });
    expect(result).toMatchObject({ suggestions: [], manualFallback: true, failureCode: "MODEL_RESPONSE_INVALID" });
    expect(mocks.invoke).toHaveBeenCalledTimes(2); expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "AI_WBS_GENERATION_FAILED", after: expect.objectContaining({ reason: "MODEL_RESPONSE_INVALID", correctionAttempts: 1 }) }));
  });
  it("does not retry authentication failures or expose provider response text", async () => {
    mocks.invoke.mockRejectedValue(Object.assign(new Error("provider-secret-response"), { status: 401 }));
    const result = await generateWbsSuggestions({ projectId: "synthetic-project", actorId: "synthetic-pm", request: "Synthetic login acceptance" });
    expect(result).toMatchObject({ failureCode: "MODEL_AUTH_FAILED", manualFallback: true });
    expect(mocks.invoke).toHaveBeenCalledTimes(1); expect(mocks.create).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("provider-secret-response");
  });
});
