import { expect, it, vi } from "vitest";
import { encodeEvent, SseDecoder, type AiStreamEvent } from "./protocol";
import { ModelOutputDecoder, withStreamInstructions } from "./model";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { AiStreamError, readAiResponse, Typewriter } from "./client";

const id = "00000000-0000-4000-8000-000000000001";
const events: AiStreamEvent[] = [{ event: "start", data: { generationId: id, version: 1 } }, { event: "delta", data: { text: "合成医疗交付🩺" } }, { event: "result", data: { generationId: id, payload: { data: [] } } }, { event: "done", data: { outcome: "completed" } }];
it("keeps streaming system instructions first for provider compatibility", () => {
  const messages = withStreamInstructions([new SystemMessage("Synthetic schema"), new HumanMessage("Synthetic context")]);
  expect(messages.map(message => message.getType())).toEqual(["system", "human"]);
  expect(messages[0].content).toContain("Synthetic schema"); expect(messages[0].content).toContain("<PUBLIC_PREVIEW>");
});
it.each([1, 2, 3, 7, 50000])("decodes fragmented UTF-8 and coalesced SSE at byte width %i", width => {
  const bytes = new TextEncoder().encode(": heartbeat\n\n" + events.map(encodeEvent).join(""));
  const decoder = new SseDecoder(); const decoded = [];
  for (let offset = 0; offset < bytes.length; offset += width) decoded.push(...decoder.push(bytes.slice(offset, offset + width)));
  decoded.push(...decoder.push()); expect(decoded).toEqual(events);
});
it("handles split CRLF and rejects a truncated final event", () => {
  const decoder = new SseDecoder(); const bytes = new TextEncoder().encode(encodeEvent(events[1]).replaceAll("\n", "\r\n")); const output = [];
  for (const byte of bytes) output.push(...decoder.push(Uint8Array.of(byte)));
  expect(output).toEqual([events[1]]);
  decoder.push(new TextEncoder().encode("event: delta\ndata: {")); expect(() => decoder.push()).toThrow("不完整");
});
it("never emits partial model tags or final JSON at any split position", () => {
  const raw = '<PUBLIC_PREVIEW>正在核对交付证据。<RESULT_JSON>{"tasks":[]}';
  for (let split = 0; split <= raw.length; split++) {
    const pieces: string[] = []; const decoder = new ModelOutputDecoder(text => pieces.push(text));
    decoder.push(raw.slice(0, split)); decoder.push(raw.slice(split));
    expect(pieces.join("")).toBe("正在核对交付证据。"); expect(decoder.finish()).toBe('{"tasks":[]}');
  }
});
it("rejects malformed or incomplete model envelopes", () => {
  const json = new ModelOutputDecoder(() => { throw new Error("JSON leaked into preview"); }); json.push('{"tasks":[]}'); expect(json.finish()).toBe('{"tasks":[]}');
  const decoder = new ModelOutputDecoder(() => {}); decoder.push("<PUBLIC_PREVIEW>preview"); expect(() => decoder.finish()).toThrow();
});
it("stops all queued typewriter characters and timers immediately", () => {
  vi.useFakeTimers();
  try {
    const append = vi.fn(); const writer = new Typewriter(append); writer.enqueue("需要取消的长预览内容");
    vi.advanceTimersByTime(24); const count = append.mock.calls.length;
    writer.stop(); vi.runAllTimers(); expect(append).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it("flushes animation on completion without a trailing timer", () => {
  vi.useFakeTimers();
  try { const append = vi.fn(); const writer = new Typewriter(append); writer.enqueue("待确认"); writer.finish(); expect(append).toHaveBeenCalledWith("待确认"); expect(vi.getTimerCount()).toBe(0); } finally { vi.useRealTimers(); }
});
function response(text: string) { return new Response(text, { headers: { "content-type": "text/event-stream" } }); }
it("requires a final result and done, rather than treating EOF as success", async () => {
  await expect(readAiResponse(response(events.slice(0, 2).map(encodeEvent).join("")), new AbortController().signal, () => {})).rejects.toThrow("连接中断");
});
it("preserves UNAUTHORIZED from an in-stream error and cancels the reader", async () => {
  const error: AiStreamEvent = { event: "error", data: { code: "UNAUTHORIZED", status: 403, message: "权限已撤销", retryable: false } };
  await expect(readAiResponse(response(encodeEvent(error)), new AbortController().signal, () => {})).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 403 });
});
it("aborts an active reader without allowing late text", async () => {
  const abort = new AbortController(); const cancelled = vi.fn();
  const body = new ReadableStream({ start(sink) { sink.enqueue(new TextEncoder().encode(encodeEvent(events[0]))); }, cancel: cancelled });
  const task = readAiResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), abort.signal, () => abort.abort());
  await expect(task).rejects.toThrow(); expect(cancelled).toHaveBeenCalledOnce();
});
it("keeps HTTP authorization errors outside the SSE parser", async () => {
  await expect(readAiResponse(Response.json({ error: "禁止访问" }, { status: 403 }), new AbortController().signal, () => {})).rejects.toBeInstanceOf(AiStreamError);
});
