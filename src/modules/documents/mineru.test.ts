import { randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { boundedBytes, createMineruClient, parseMineruArchive } from "./mineru";
const archive = () => Buffer.from(zipSync({ "full.md": strToU8("# Synthetic requirement\nApproval required."), "test_content_list.json": strToU8(JSON.stringify([{ type: "text", text: "Approval required.", page_idx: 0 }, { type: "text", text: "No page available." }])) }));
describe("MinerU cloud adapter", () => {
  it("normalizes real source page indexes and leaves missing pages unknown", () => {
    expect(parseMineruArchive(archive()).blocks).toEqual([{ text: "Approval required.", page: 1, type: "text" }, { text: "No page available.", page: null, type: "text" }]);
  });
  it("rejects invalid archives, path traversal and oversized expanded content", () => {
    for (const bytes of [Buffer.from("notzip"), Buffer.from(zipSync({ "../full.md": strToU8("synthetic") })), Buffer.from(zipSync({ "full.md": new Uint8Array(8 * 1024 * 1024 + 1) }))]) expect(() => parseMineruArchive(bytes)).toThrow();
  });
  it("never sends API credentials to upload or download destinations", async () => {
    const apiKey = randomUUID(); const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(Response.json({ code: 0, data: { batch_id: "batch", file_urls: ["https://synthetic.oss-cn-shanghai.aliyuncs.com/upload?signature=synthetic"] } })).mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(Response.json({ code: 0, data: { batch_id: "batch", extract_result: [{ file_name: "synthetic.pdf", data_id: "job", state: "done", full_zip_url: "https://cdn-mineru.openxlab.org.cn/result.zip" }] } })).mockResolvedValueOnce(new Response(new Uint8Array(archive())));
    const client = createMineruClient({ baseUrl: "https://mineru.net/api/v4", apiKey, fetch: fetcher });
    const remote = await client.reserve("job", "synthetic.pdf", "vlm"); await client.upload(remote.uploadUrl, Buffer.from("%PDF-test"));
    const result = await client.poll(remote.batchId, "job", "synthetic.pdf"); await client.result(result.resultUrl!);
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
    for (const index of [1, 3]) expect(new Headers(fetcher.mock.calls[index]![1]?.headers).has("authorization")).toBe(false);
  });
  it("rejects mismatched document responses and private transfer destinations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ code: 0, data: { batch_id: "batch", file_urls: ["http://127.0.0.1/private"] } })).mockResolvedValueOnce(Response.json({ code: 0, data: { batch_id: "batch", extract_result: [{ file_name: "other.pdf", state: "done" }] } }));
    const client = createMineruClient({ baseUrl: "https://mineru.net/api/v4", apiKey: randomUUID(), fetch: fetcher });
    await expect(client.reserve("job", "synthetic.pdf", "vlm")).rejects.toMatchObject({ code: "MINERU_TRANSFER_URL" });
    await expect(client.poll("batch", "job", "synthetic.pdf")).rejects.toMatchObject({ code: "MINERU_SOURCE_MISMATCH" });
  });
  it("bounds API bodies and sanitizes remote errors", async () => {
    await expect(boundedBytes(new Response("too large", { headers: { "content-length": "99999" } }), 100)).rejects.toThrow();
    const client = createMineruClient({ baseUrl: "https://mineru.net/api/v4", apiKey: randomUUID(), fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive service detail", { status: 503 })) });
    await expect(client.reserve("job", "synthetic.pdf", "vlm")).rejects.toMatchObject({ code: "MINERU_HTTP_503", retryable: true });
  });
  it("does not forward authentication across redirects and rejects unknown result hosts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
    const client = createMineruClient({ baseUrl: "https://mineru.net/api/v4", apiKey: randomUUID(), fetch: fetcher });
    await expect(client.result("https://cdn-mineru.openxlab.org.cn/result.zip")).rejects.toMatchObject({ code: "MINERU_TRANSFER_URL" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
