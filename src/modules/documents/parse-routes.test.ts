import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), queue: vi.fn(), find: vi.fn(), history: vi.fn(), preview: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocks.actor }));
vi.mock("./parse-service", async (original) => ({ ...await original<typeof import("./parse-service")>(), requestDocumentParse: mocks.queue }));
vi.mock("./parse-repositories", () => ({ listParseJobs: mocks.history, previewParseJob: mocks.preview }));
vi.mock("./repositories", () => ({ findDocument: mocks.find }));
import { POST, GET } from "@/app/api/documents/[documentId]/parse/route";
import { POST as retry } from "@/app/api/documents/[documentId]/retry/route";
import { GET as preview } from "@/app/api/documents/[documentId]/preview/route";
const id = randomUUID(); const context = { params: Promise.resolve({ documentId: id }) };
const request = (body: unknown) => new Request("http://localhost/parse", { method: "POST", body: JSON.stringify(body) });
describe("document parse API permissions", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.find.mockResolvedValue({ parsedVersion: 1 }); mocks.history.mockResolvedValue([]); mocks.preview.mockResolvedValue({ status: "SUCCEEDED", markdown: "Synthetic" }); mocks.queue.mockResolvedValue({ id, version: 1, status: "QUEUED" }); });
  it.each([null, "MEMBER", "QA"])("denies submission/retry by %s", async (role) => {
    mocks.actor.mockResolvedValue(role ? { id, role } : null);
    for (const action of [POST, retry]) expect((await action(request({}), context)).status).toBe(role ? 403 : 401);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it.each(["PM", "ADMIN"])("allows %s asynchronous submission with explicit cloud consent", async (role) => {
    mocks.actor.mockResolvedValue({ id, role });
    const input = { requestKey: randomUUID(), expectedVersion: 0, cloudProcessingConfirmed: true };
    expect((await POST(request(input), context)).status).toBe(202);
    expect((await POST(request({ ...input, cloudProcessingConfirmed: false }), context)).status).toBe(400);
  });
  it.each(["ADMIN", "PM", "MEMBER", "QA"])("allows %s to read history/preview", async (role) => {
    mocks.actor.mockResolvedValue({ id, role });
    expect((await GET(request({}), context)).status).toBe(200);
    expect((await preview(request({}), context)).status).toBe(200);
  });
  it("rejects unavailable previews and bad IDs", async () => {
    mocks.actor.mockResolvedValue({ id, role: "QA" }); mocks.find.mockResolvedValue({ parsedVersion: null });
    expect((await preview(request({}), context)).status).toBe(409);
    expect((await GET(request({}), { params: Promise.resolve({ documentId: "bad" }) })).status).toBe(400);
  });
  it("labels bounded previews and never returns result storage keys", async () => {
    mocks.actor.mockResolvedValue({ id, role: "QA" });
    mocks.preview.mockResolvedValue({ status: "SUCCEEDED", markdown: "x".repeat(200001), blocks: [{ text: "y".repeat(2001), page: 1 }] });
    const response = await preview(request({}), context); const result = (await response.json()).data;
    expect(result.previewTruncated).toBe(true); expect(result.markdown).toHaveLength(200000); expect(result.blocks[0].text).toHaveLength(2000);
  });
});
