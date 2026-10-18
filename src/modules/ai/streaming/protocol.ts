import { z } from "zod";

export const streamEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("start"), data: z.object({ generationId: z.uuid(), version: z.literal(1) }) }),
  z.object({ event: z.literal("progress"), data: z.object({ stage: z.string(), message: z.string() }) }),
  z.object({ event: z.literal("delta"), data: z.object({ text: z.string().max(2000) }) }),
  z.object({ event: z.literal("result"), data: z.object({ generationId: z.uuid(), payload: z.unknown() }) }),
  z.object({ event: z.literal("done"), data: z.object({ outcome: z.enum(["completed", "failed"]) }) }),
  z.object({ event: z.literal("error"), data: z.object({ code: z.string(), status: z.number(), message: z.string(), retryable: z.boolean() }) }),
]);
export type AiStreamEvent = z.infer<typeof streamEventSchema>;
export type GenerationStream = { generationId: string; signal: AbortSignal; emit: (event: AiStreamEvent) => void };

export function encodeEvent(value: AiStreamEvent): string {
  return `event: ${value.event}\ndata: ${JSON.stringify(value.data)}\n\n`;
}

/** Incremental UTF-8 decoding; a transport chunk is never assumed to be an SSE event. */
export class SseDecoder {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";
  push(chunk?: Uint8Array): AiStreamEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: chunk !== undefined });
    // Normalize only complete CRLF pairs, including pairs split across transport chunks.
    this.buffer = this.buffer.replace(/\r\n/g, "\n");
    if (this.buffer.length > 2_000_000) throw new Error("流式事件超出大小限制");
    const result: AiStreamEvent[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, boundary); this.buffer = this.buffer.slice(boundary + 2);
      const lines = block.split("\n");
      const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
      const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
      if (!event && !data) continue; // heartbeat comments
      result.push(streamEventSchema.parse({ event, data: JSON.parse(data) }));
    }
    if (chunk === undefined && this.buffer.trim()) throw new Error("流式事件不完整");
    return result;
  }
}
