import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), upload: vi.fn(), list: vi.fn(), download: vi.fn(), recover: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocks.actor }));
vi.mock("./services", () => ({ uploadDocument: mocks.upload, downloadDocument: mocks.download, recoverDocument: mocks.recover, retryDocumentCleanup: mocks.cleanup }));
vi.mock("./repositories", () => ({ listDocuments: mocks.list }));
import { GET, POST } from "@/app/api/projects/[projectId]/documents/route";
import { GET as download } from "@/app/api/documents/[documentId]/download/route";
import { POST as recover } from "@/app/api/documents/[documentId]/recover/route";
const id = randomUUID(); const context = { params: Promise.resolve({ projectId: id }) };
function uploadRequest() {
  const form = new FormData(); form.set("file", new File(["%PDF-1.4\nsynthetic\n%%EOF"], "synthetic.pdf", { type: "application/pdf" })); form.set("uploadKey", randomUUID()); form.set("syntheticOnly", "true");
  return new Request("http://localhost/documents", { method: "POST", body: form });
}
describe("document route permissions", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.list.mockResolvedValue([]); mocks.upload.mockResolvedValue({ id, duplicate: false }); });
  it.each([null, "MEMBER", "QA", "ADMIN"])("rejects upload by %s before reading storage", async (role) => {
    mocks.actor.mockResolvedValue(role ? { id, role } : null);
    expect((await POST(uploadRequest(), context)).status).toBe(role ? 403 : 401); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("allows PM upload and propagates request metadata", async () => {
    mocks.actor.mockResolvedValue({ id, role: "PM" });
    expect((await POST(uploadRequest(), context)).status).toBe(201);
    expect(mocks.upload).toHaveBeenCalledWith(id, expect.objectContaining({ filename: "synthetic.pdf" }), expect.objectContaining({ actorId: id }));
  });
  it.each(["ADMIN", "PM", "MEMBER", "QA"])("allows %s to list and download", async (role) => {
    mocks.actor.mockResolvedValue({ id, role }); mocks.download.mockResolvedValue({ filename: "合成.pdf", bytes: Buffer.from("%PDF-test") });
    expect((await GET(new Request("http://localhost/documents"), context)).status).toBe(200);
    const response = await download(new Request("http://localhost/download"), { params: Promise.resolve({ documentId: id }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("denies guest download and QA recovery, and validates project IDs", async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await download(new Request("http://localhost/download"), { params: Promise.resolve({ documentId: id }) })).status).toBe(401);
    mocks.actor.mockResolvedValue({ id, role: "QA" });
    expect((await recover(new Request("http://localhost/recover"), { params: Promise.resolve({ documentId: id }) })).status).toBe(403);
    mocks.actor.mockResolvedValue({ id, role: "PM" });
    expect((await POST(uploadRequest(), { params: Promise.resolve({ projectId: "bad" }) })).status).toBe(400);
  });
});
