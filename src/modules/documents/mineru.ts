import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";

export class ParseError extends Error {
  constructor(public code: string, public retryable = false) { super(code); }
}
export const parsedBlockSchema = z.object({ text: z.string(), page: z.number().int().positive().nullable(), type: z.string() });
export type ParsedBlock = z.infer<typeof parsedBlockSchema>;
export type ParsedResult = { markdown: string; blocks: ParsedBlock[]; raw: Buffer };
export type MineruClient = {
  reserve: (jobId: string, filename: string, model: string) => Promise<{ batchId: string; uploadUrl: string }>;
  upload: (url: string, bytes: Buffer) => Promise<void>;
  poll: (batchId: string, jobId: string, filename: string) => Promise<{ state: "pending" | "done" | "failed"; resultUrl?: string }>;
  result: (url: string) => Promise<ParsedResult>;
};
export function mineruModel() {
  const parsed = z.enum(["vlm", "pipeline"]).safeParse(process.env.MINERU_MODEL_VERSION || "vlm");
  if (!parsed.success) throw new ParseError("MINERU_CONFIGURATION");
  return parsed.data;
}
export async function boundedBytes(response: Response, limit: number) {
  if (!response.body || Number(response.headers.get("content-length") || 0) > limit) throw new ParseError("MINERU_RESULT_LIMIT");
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) { await reader.cancel(); throw new ParseError("MINERU_RESULT_LIMIT"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}
export function parseMineruArchive(raw: Buffer): ParsedResult {
  if (raw.length > 32 * 1024 * 1024) throw new ParseError("MINERU_RESULT_LIMIT");
  let total = 0; let count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(raw, { filter: (file) => {
      if (++count > 1024) throw new ParseError("MINERU_RESULT_LIMIT");
      const selected = /(?:^|\/)full\.md$/.test(file.name) || /(?:^|\/)[^/]*content_list\.json$/.test(file.name);
      if (!selected) return false;
      if (file.name.startsWith("/") || file.name.includes("\\") || file.name.split("/").includes("..")) throw new ParseError("MINERU_RESULT_INVALID");
      total += file.originalSize;
      if (file.originalSize > 8 * 1024 * 1024 || file.size > 8 * 1024 * 1024 || total > 16 * 1024 * 1024) throw new ParseError("MINERU_RESULT_LIMIT");
      return true;
    } });
  } catch (error) { throw error instanceof ParseError ? error : new ParseError("MINERU_RESULT_INVALID"); }
  const md = Object.entries(entries).filter(([name]) => /(?:^|\/)full\.md$/.test(name));
  const lists = Object.entries(entries).filter(([name]) => /content_list\.json$/.test(name));
  if (md.length !== 1 || lists.length > 1) throw new ParseError("MINERU_RESULT_INVALID");
  const markdown = strFromU8(md[0]![1]).trim();
  if (!markdown) throw new ParseError("MINERU_RESULT_EMPTY");
  const blocks: ParsedBlock[] = [];
  if (lists.length) {
    let content: unknown;
    try { content = JSON.parse(strFromU8(lists[0]![1])); } catch { throw new ParseError("MINERU_RESULT_INVALID"); }
    const list = z.array(z.object({ type: z.string(), text: z.string().optional(), page_idx: z.number().int().min(0).optional(), table_body: z.string().optional(), table_caption: z.array(z.string()).optional(), image_caption: z.array(z.string()).optional() }).passthrough()).max(20000).safeParse(content);
    if (!list.success) throw new ParseError("MINERU_RESULT_INVALID");
    for (const item of list.data) {
      const text = item.text ?? [item.table_caption?.join("\n"), item.table_body, item.image_caption?.join("\n")].filter(Boolean).join("\n");
      if (text.trim()) blocks.push({ text, page: item.page_idx === undefined ? null : item.page_idx + 1, type: item.type });
    }
  }
  return { markdown, blocks, raw };
}
export function createMineruClient(config?: { baseUrl: string; apiKey: string; fetch?: typeof fetch }): MineruClient {
  const base = new URL(config?.baseUrl || process.env.MINERU_BASE_URL || "https://mineru.net/api/v4");
  const key = config?.apiKey ?? process.env.MINERU_API_KEY;
  if (!key || base.username || base.password || base.search || base.hash || (base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new ParseError("MINERU_CONFIGURATION");
  const request = config?.fetch ?? fetch;
  function transferUrl(value: string) {
    let url: URL;
    try { url = new URL(value); } catch { throw new ParseError("MINERU_TRANSFER_URL"); }
    const known = ["mineru.net", "openxlab.org.cn", "aliyuncs.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    if (url.username || url.password || url.hash || (url.origin !== base.origin && (url.protocol !== "https:" || !known))) throw new ParseError("MINERU_TRANSFER_URL");
    return url.toString();
  }
  async function api(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try { response = await request(`${base.toString().replace(/\/$/, "")}/${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(15000) }); }
    catch { throw new ParseError("MINERU_TRANSPORT", true); }
    if (!response.ok) throw new ParseError(`MINERU_HTTP_${response.status}`, response.status === 429 || response.status >= 500);
    let payload: unknown;
    try { payload = JSON.parse((await boundedBytes(response, 1024 * 1024)).toString("utf8")); } catch { throw new ParseError("MINERU_PROTOCOL"); }
    const envelope = z.object({ code: z.number(), data: z.unknown().optional() }).safeParse(payload);
    if (!envelope.success) throw new ParseError("MINERU_PROTOCOL");
    if (envelope.data.code !== 0) throw new ParseError("MINERU_API_REJECTED");
    return envelope.data.data;
  }
  return {
    async reserve(jobId, filename, model) {
      const data = z.object({ batch_id: z.string().min(1).max(191), file_urls: z.array(z.string()).length(1) }).safeParse(await api("file-urls/batch", { files: [{ name: filename, data_id: jobId }], model_version: model, enable_table: true, enable_formula: true, language: "ch" }));
      if (!data.success) throw new ParseError("MINERU_PROTOCOL");
      return { batchId: data.data.batch_id, uploadUrl: transferUrl(data.data.file_urls[0]!) };
    },
    async upload(url, bytes) {
      let response: Response;
      try { response = await request(transferUrl(url), { method: "PUT", body: new Uint8Array(bytes), redirect: "error", signal: AbortSignal.timeout(30000) }); }
      catch { throw new ParseError("MINERU_UPLOAD_TRANSPORT", true); }
      if (!response.ok) throw new ParseError("MINERU_UPLOAD_REJECTED", response.status >= 500 || response.status === 429);
      await response.body?.cancel();
    },
    async poll(batchId, jobId, filename) {
      const data = z.object({ batch_id: z.string(), extract_result: z.array(z.object({ data_id: z.string().optional(), file_name: z.string(), state: z.enum(["waiting-file", "pending", "running", "converting", "done", "failed"]), full_zip_url: z.string().optional() })) }).safeParse(await api(`extract-results/batch/${encodeURIComponent(batchId)}`));
      if (!data.success || data.data.batch_id !== batchId || data.data.extract_result.length !== 1) throw new ParseError("MINERU_PROTOCOL");
      const item = data.data.extract_result[0]!;
      if (item.file_name !== filename || (item.data_id !== undefined && item.data_id !== jobId)) throw new ParseError("MINERU_SOURCE_MISMATCH");
      if (item.state === "failed") return { state: "failed" };
      if (item.state === "done") {
        if (!item.full_zip_url) throw new ParseError("MINERU_PROTOCOL");
        return { state: "done", resultUrl: transferUrl(item.full_zip_url) };
      }
      return { state: "pending" };
    },
    async result(url) {
      let target = transferUrl(url);
      for (let hop = 0; hop < 4; hop++) {
        let response: Response;
        try { response = await request(target, { redirect: "manual", signal: AbortSignal.timeout(30000) }); } catch { throw new ParseError("MINERU_RESULT_TRANSPORT", true); }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location"); await response.body?.cancel();
          if (!location) throw new ParseError("MINERU_TRANSFER_URL");
          target = transferUrl(new URL(location, target).toString()); continue;
        }
        if (!response.ok) throw new ParseError("MINERU_RESULT_DOWNLOAD", response.status >= 500);
        return parseMineruArchive(await boundedBytes(response, 32 * 1024 * 1024));
      }
      throw new ParseError("MINERU_REDIRECT_LIMIT");
    },
  };
}
