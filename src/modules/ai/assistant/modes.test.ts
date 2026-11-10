import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const model = vi.hoisted(() => ({ content: "", calls: [] as unknown[][], cancel: vi.fn() }));
vi.mock("@/modules/ai/chat-model", () => ({ getConfiguredLlm: () => ({ modelName: "synthetic", model: { stream: async (...args: unknown[]) => { model.calls.push(args); return { async *[Symbol.asyncIterator]() { for (let i = 0; i < model.content.length; i += 7) yield { content: model.content.slice(i, i + 7) }; }, cancel: async () => { model.cancel(); } }; } } }) }));
import { GENERAL_PREFIX, REPORT_MESSAGE, routeQuestion } from "./routing";
import { requireWebConfirmation, SearchConfirmationRequired, type WebBinding } from "./web-confirmation";
import { searchWeb, needsOfficialSources, webSearchEndpoint } from "./web-search";
import { streamGeneralAnswer, GENERAL_PROMPT, WEB_PROMPT } from "./model";
import { safeSourceUrl } from "./types";
const a = "00000000-0000-4000-8000-000000000001";
const binding: WebBinding = { actorId: a, actorRole: "PM", conversationId: a, projectId: null, expectedVersion: 1, requestKey: a, question: "Y市HIS接口规范研究", mode: "WEB" };
function challenge(value = binding, now = Date.now()) { try { requireWebConfirmation(value, undefined, [], now); throw new Error("Missing confirmation"); } catch (error) { if (error instanceof SearchConfirmationRequired) return error.confirmation; throw error; } }
beforeEach(() => { vi.stubEnv("SESSION_SECRET", "synthetic-confirmation-secret-at-least-32-characters"); vi.stubEnv("TAVILY_API_KEY", "synthetic-test-key"); vi.stubEnv("TAVILY_SEARCH_URL", "https://api.tavily.com/search"); model.calls = []; model.cancel.mockClear(); });
afterEach(() => vi.unstubAllEnvs());
describe("assistant intent routing", () => {
  it.each(["有多少任务？", "谁的负荷最重？", "当前项目进度怎么样？", "本项目还欠哪些交付物？", "How many tasks are in my project?"])("blocks live report guessing in every mode: %s", question => { for (const mode of ["SMART", "INTERNAL", "WEB"] as const) expect(routeQuestion(mode, question).intent).toBe("REPORT_GUARD"); expect(REPORT_MESSAGE).toContain("暂不支持直接查询实时业务报表"); });
  it.each(["WBS是什么？", "怎么开启动会？", "什么是逾期任务？"])("allows clearly educational questions without project claims: %s", question => expect(routeQuestion("SMART", question).intent).toBe("GENERAL"));
  it.each(["内部签名日期要求是什么？", "这些签名要求有哪些证据？"])("keeps internal facts and contextual follow-ups out of general knowledge: %s", question => expect(routeQuestion("SMART", question).intent).toBe("INTERNAL"));
  it("keeps contacts and project facts internal even in web mode", () => { expect(routeQuestion("WEB", "张工的邮箱").intent).toBe("INTERNAL"); expect(routeQuestion("WEB", "本项目的验收条件是什么").intent).toBe("INTERNAL"); expect(routeQuestion("SMART", "Y市HIS怎么开启动会").intent).toBe("INTERNAL"); expect(routeQuestion("SMART", "最新的FDA指南").intent).toBe("NEED_WEB"); });
});
describe("general knowledge output", () => {
  it.each(["WBS是工作分解结构。", `${GENERAL_PREFIX}\n\nWBS是工作分解结构。`, "字".repeat(600)])("enforces the opening and total 300-character cap", async text => { model.content = text; const chunks: string[] = []; const result = await streamGeneralAnswer("WBS是什么", new AbortController().signal, async value => { chunks.push(value); }); expect(result.answer.startsWith(GENERAL_PREFIX)).toBe(true); expect(Array.from(result.answer).length).toBeLessThanOrEqual(300); expect(chunks.join("")).toBe(result.answer); expect(chunks[0]).toBe(`${GENERAL_PREFIX}\n\n`); expect(GENERAL_PROMPT).toContain("300字以内"); expect(JSON.stringify(model.calls)).not.toContain("internalEvidence"); expect(model.cancel).toHaveBeenCalled(); });
  it("does not put internal history into the web prompt", () => { expect(WEB_PROMPT).toContain("外部网页摘录"); expect(WEB_PROMPT).toContain("不代表公司内部制度"); });
});
describe("external search confirmation", () => {
  it("binds approval to the exact user, question, scope, version and request, with expiry", () => { const now = 1800000000000; const proof = challenge(binding, now); expect(proof.sensitive).toBe(true); expect(proof.message).toBe("您的问题包含项目专有名词，确认要向外网发送吗？"); requireWebConfirmation(binding, proof.token, [], now + 1); for (const changed of [{ ...binding, question: "另一项目" }, { ...binding, actorId: a.slice(0, -1) + "2" }, { ...binding, expectedVersion: 2 }, { ...binding, requestKey: a.slice(0, -1) + "3" }, { ...binding, projectId: a }]) expect(() => requireWebConfirmation(changed, proof.token, [], now + 1)).toThrow(); expect(() => requireWebConfirmation(binding, proof.token, [], now + 300001)).toThrow(); expect(() => requireWebConfirmation(binding, `${proof.token}x`, [], now)).toThrow(); });
  it("requires preview for benign queries and blocks obvious patient identifiers before issuing approval", () => { expect(challenge({ ...binding, question: "最新WBS方法" }).sensitive).toBe(false); expect(() => challenge({ ...binding, question: "患者姓名 张某 住院号123" })).toThrow("移除患者标识"); });
});
describe("external provider boundary", () => {
  it("supports base URLs and complete search endpoints while preserving explicit endpoint precedence", () => {
    vi.stubEnv("TAVILY_SEARCH_URL", ""); vi.stubEnv("TAVILY_BASE_URL", "https://search.example.org/tavily/"); expect(webSearchEndpoint()).toBe("https://search.example.org/tavily/search");
    vi.stubEnv("TAVILY_BASE_URL", "https://search.example.org/tavily/search"); expect(webSearchEndpoint()).toBe("https://search.example.org/tavily/search");
    vi.stubEnv("TAVILY_SEARCH_URL", "https://api.tavily.com/search"); expect(webSearchEndpoint()).toBe("https://api.tavily.com/search");
    vi.stubEnv("TAVILY_SEARCH_URL", ""); vi.stubEnv("TAVILY_BASE_URL", ""); expect(webSearchEndpoint()).toBe("https://api.tavily.com/search");
  });
  it("only sends the confirmed query and keeps official medical sources with real URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [{ title: "FDA guide", url: "https://www.fda.gov/example", content: "<b>Public synthetic standard</b>", published_date: "2026-01-01" }, { title: "Untrusted", url: "https://external.example.org/", content: "not official" }, { title: "Private", url: "http://127.0.0.1/admin", content: "private" }] }));
    const result = await searchWeb("最新FDA医疗规范", new AbortController().signal, fetcher); expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ sourceType: "WEB", webUrl: "https://www.fda.gov/example", snippet: "Public synthetic standard" }); const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body)); expect(body.query).toBe("最新FDA医疗规范"); expect(body.include_answer).toBe(false); expect(body.include_raw_content).toBe(false); expect(body.internalEvidence).toBeUndefined(); expect(body.history).toBeUndefined(); expect(body.include_domains).toContain("fda.gov"); expect(needsOfficialSources("最新监管标准")).toBe(true);
  });
  it("fails explicitly without credentials and forwards cancellation", async () => { vi.stubEnv("TAVILY_API_KEY", ""); const fetcher = vi.fn(); await expect(searchWeb("test", new AbortController().signal, fetcher)).rejects.toThrow("尚未配置"); expect(fetcher).not.toHaveBeenCalled(); vi.stubEnv("TAVILY_API_KEY", "synthetic"); const controller = new AbortController(); controller.abort(new DOMException("Cancelled", "AbortError")); await expect(searchWeb("test", controller.signal, fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
  it.each(["javascript:alert(1)", "http://127.1/private", "http://10.1.1.1/x", "https://user:password@example.org", "http://172.16.0.1/x"])("rejects unsafe source links: %s", url => expect(safeSourceUrl(url)).toBeNull());
});
