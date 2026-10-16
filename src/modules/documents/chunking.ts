import { createHash } from "node:crypto";
import { z } from "zod";
import { parsedBlockSchema } from "./mineru";

export const CHUNK_SIZE = 2000;
export const CHUNK_OVERLAP = 200;
export const CHUNKER_VERSION = "blocks-v1";
export type TextChunk = { ordinal: number; text: string; textSha256: string; page: number | null; blockIndex: number | null; startOffset: number; endOffset: number };

/** Offsets are UTF-16 offsets into the original block (or Markdown fallback). */
export function chunkParsedDocument(markdown: string, input: unknown): TextChunk[] {
  const parsed = z.array(parsedBlockSchema).safeParse(input);
  const sources = parsed.success && parsed.data.some((block) => block.text.trim())
    ? parsed.data.map((block, blockIndex) => ({ ...block, blockIndex }))
    : [{ text: markdown, page: null, blockIndex: null }];
  const chunks: TextChunk[] = [];
  for (const source of sources) {
    for (let start = 0; start < source.text.length;) {
      let end = Math.min(start + CHUNK_SIZE, source.text.length);
      // Never cut a surrogate pair in half.
      if (end < source.text.length && /[\uD800-\uDBFF]/.test(source.text[end - 1])) end--;
      const text = source.text.slice(start, end);
      if (text.trim()) chunks.push({ ordinal: chunks.length, text, textSha256: createHash("sha256").update(text).digest("hex"), page: source.page, blockIndex: source.blockIndex, startOffset: start, endOffset: end });
      if (chunks.length > 20000) throw new Error("DOCUMENT_CHUNK_LIMIT");
      if (end === source.text.length) break;
      start = end - CHUNK_OVERLAP;
      if (/[\uDC00-\uDFFF]/.test(source.text[start])) start++;
    }
  }
  return chunks;
}
