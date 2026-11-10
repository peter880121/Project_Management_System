import { z } from "zod";
import { createHash } from "node:crypto";
import { ProjectError } from "@/modules/projects/services";
import { safeSourceUrl, type Citation } from "./types";
export function webSearchConfigured() { return !!process.env.TAVILY_API_KEY?.trim(); }
export const WEB_SEARCH_NOT_CONFIGURED = "尚未配置联网搜索，请联系管理员配置搜索服务后重启应用";
export function webSearchEndpoint() {
  if (process.env.TAVILY_SEARCH_URL?.trim()) return process.env.TAVILY_SEARCH_URL.trim();
  const url = new URL(process.env.TAVILY_BASE_URL?.trim() || "https://api.tavily.com");
  if (url.search || url.hash) throw new ProjectError("联网搜索服务配置无效", 503);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/search") ? path : `${path}/search`;
  return url.href;
}
export const officialDomains = ["fda.gov", "ecfr.gov", "gov.cn", "nmpa.gov.cn", "nhc.gov.cn", "who.int", "iso.org", "ich.org", "health.ec.europa.eu", "eur-lex.europa.eu"];
export const needsOfficialSources = (query: string) => /法规|法条|监管|标准|合规|GxP|GMP|CFR|FDA|NMPA|ISO\s*\d|医疗.{0,6}(?:规范|政策)/i.test(query);
const resultSchema = z.object({ title: z.string().min(1).max(1000), url: z.string().max(4096), content: z.string().max(100000), published_date: z.string().nullable().optional() });
const responseSchema = z.object({ results: z.array(z.unknown()).max(20) });
export async function searchWeb(query: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Citation[]> {
  if (!webSearchConfigured()) throw new ProjectError(WEB_SEARCH_NOT_CONFIGURED, 503);
  // Only server configuration chooses a provider endpoint; user/source URLs are never fetched.
  const endpoint = webSearchEndpoint(); const url = new URL(endpoint);
  const localFixture = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localFixture || url.username || url.password) throw new ProjectError("联网搜索服务配置无效", 503);
  const controller = new AbortController(); const abort = () => controller.abort(signal.reason); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); const deadline = setTimeout(() => controller.abort(new Error("SEARCH_TIMEOUT")), 10000);
  try {
    controller.signal.throwIfAborted();
    const response = await fetcher(endpoint, { method: "POST", signal: controller.signal, redirect: "error", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY!.trim()}` }, body: JSON.stringify({ query, search_depth: "basic", max_results: 5, include_answer: false, include_raw_content: false, include_images: false, auto_parameters: false, ...(needsOfficialSources(query) ? { include_domains: officialDomains } : {}) }) });
    if (!response.ok) { await response.body?.cancel(); throw new ProjectError("联网搜索服务暂不可用，请稍后重试", 503); }
    if (!response.body) throw new ProjectError("联网搜索返回了空响应", 503);
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 512000) { await reader.cancel(); throw new Error("Search result too large"); } chunks.push(value); } } finally { reader.releaseLock(); }
    const data = responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); const seen = new Set<string>(); const citations: Citation[] = [];
    for (const raw of data.results) {
      const parsed = resultSchema.safeParse(raw); if (!parsed.success) continue; const item = parsed.data; const webUrl = safeSourceUrl(item.url); if (!webUrl || seen.has(webUrl)) continue;
      const host = new URL(webUrl).hostname;
      if (needsOfficialSources(query) && !officialDomains.some(domain => host === domain || host.endsWith(`.${domain}`))) continue;
      seen.add(webUrl); const snippet = item.content.replace(/<[^>]*>/g, "").slice(0, 1500).trim(); if (!snippet) continue;
      const parsedDate = item.published_date ? Date.parse(item.published_date) : NaN;
      citations.push({ ordinal: citations.length + 1, sourceType: "WEB", projectId: null, documentId: null, chunkId: null, contactId: null, version: null, page: null, title: item.title.replace(/<[^>]*>/g, "").slice(0, 255), snippet, contentSha256: createHash("sha256").update(snippet).digest("hex"), webUrl, retrievedAt: new Date(), publishedAt: Number.isFinite(parsedDate) ? new Date(parsedDate) : null });
      if (citations.length === 5) break;
    }
    controller.signal.throwIfAborted(); return citations;
  } catch (error) { signal.throwIfAborted(); if (error instanceof ProjectError) throw error; throw new ProjectError("联网搜索超时或响应无效，请稍后重试", 503); }
  finally { clearTimeout(deadline); signal.removeEventListener("abort", abort); }
}
