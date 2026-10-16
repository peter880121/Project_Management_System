import { afterEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ chat: vi.fn(), embeddings: vi.fn(), embedQuery: vi.fn() }));
vi.mock("@langchain/openai", () => ({
  ChatOpenAI: mocked.chat,
  OpenAIEmbeddings: mocked.embeddings,
}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks(); });
it("uses the compatible endpoint and explicit model precedence", async () => {
  vi.stubEnv("AI_PROVIDER", "openai"); vi.stubEnv("AI_MODEL", ""); vi.stubEnv("LLM_DEFAULT_MODEL", "synthetic-chat");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key"); vi.stubEnv("OPENAI_BASE_URL", "http://localhost:8123/v1");
  mocked.chat.mockImplementation(function () { return {}; });
  const { getConfiguredLlm } = await import("./chat-model");
  expect(getConfiguredLlm().modelName).toBe("synthetic-chat");
  expect(mocked.chat).toHaveBeenCalledWith(expect.objectContaining({ configuration: { baseURL: "http://localhost:8123/v1" }, maxRetries: 0, timeout: 30000 }));
  vi.stubEnv("AI_MODEL", "explicit-model"); expect(getConfiguredLlm().modelName).toBe("explicit-model");
});
it("uses the same endpoint and 1536 float dimensions for both document and history embeddings", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key"); vi.stubEnv("OPENAI_BASE_URL", "http://localhost:8123/v1"); vi.stubEnv("OPENAI_EMBEDDING_MODEL", "synthetic-embedding");
  mocked.embedQuery.mockResolvedValue(Array(1536).fill(0));
  mocked.embeddings.mockImplementation(function () { return { embedQuery: mocked.embedQuery }; });
  const { embedDocumentText, embedTaskText } = await import("./embeddings");
  expect((await embedDocumentText("synthetic document")).length).toBe(1536);
  expect((await embedTaskText("synthetic history")).length).toBe(1536);
  expect(mocked.embeddings).toHaveBeenCalledWith(expect.objectContaining({ configuration: { baseURL: "http://localhost:8123/v1" }, dimensions: 1536, encodingFormat: "float", model: "synthetic-embedding" }));
});
