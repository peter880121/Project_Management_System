import { SseDecoder, type AiStreamEvent } from "./protocol";

export class AiStreamError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

export async function readAiResponse<T>(response: Response, signal: AbortSignal, onEvent: (event: AiStreamEvent) => void): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new AiStreamError(typeof body.error === "string" ? body.error : "AI 请求失败", [401, 403].includes(response.status) ? "UNAUTHORIZED" : "HTTP_ERROR", response.status);
  }
  // Retain compatibility with existing JSON callers and explicit browser fixtures.
  if (response.headers.get("content-type")?.includes("application/json")) return await response.json() as T;
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new Error("无效的流式响应");
  const reader = response.body.getReader(); const decoder = new SseDecoder();
  let result: T | undefined; let receivedResult = false; let done = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  function consume(events: AiStreamEvent[]) {
    for (const event of events) {
      signal.throwIfAborted();
      if (done) throw new Error("流在结束事件后包含额外数据");
      if (event.event === "error") throw new AiStreamError(event.data.message, event.data.code, event.data.status);
      if (event.event === "result") {
        if (receivedResult) throw new Error("流包含重复结果");
        result = event.data.payload as T; receivedResult = true;
      }
      if (event.event === "done") {
        if (event.data.outcome !== "completed" || !receivedResult) throw new Error("生成未完成");
        done = true;
      }
      onEvent(event);
    }
  }
  try {
    signal.throwIfAborted();
    while (true) {
      const part = await reader.read(); signal.throwIfAborted();
      if (part.done) { consume(decoder.push()); break; }
      consume(decoder.push(part.value));
    }
    if (!done || !receivedResult) throw new Error("生成连接中断，请核对待确认列表后重试");
    return result as T;
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** A single cancellable timer, independent of network timing. */
export class Typewriter {
  private queue: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private append: (text: string) => void) {}
  enqueue(value: string) {
    this.queue.push(...Array.from(value));
    if (this.queue.length > 6000) throw new Error("预览超出大小限制");
    if (!this.timer) this.schedule();
  }
  private schedule() {
    if (!this.queue.length) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.append(this.queue.splice(0, 3).join("")); this.schedule();
    }, 24);
  }
  stop() { clearTimeout(this.timer); this.timer = undefined; this.queue = []; }
  finish() { clearTimeout(this.timer); this.timer = undefined; const rest = this.queue.join(""); this.queue = []; if (rest) this.append(rest); }
}
