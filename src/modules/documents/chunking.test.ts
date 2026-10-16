import { describe, expect, it } from "vitest";
import { chunkParsedDocument, CHUNK_SIZE, CHUNK_OVERLAP } from "./chunking";
describe("immutable document chunks", () => {
  it("preserves pages, block offsets and hashes without joining unrelated pages", () => {
    const text = "a".repeat(CHUNK_SIZE * 2);
    const chunks = chunkParsedDocument("unused", [{ text, page: 3, type: "text" }, { text: "table evidence", page: 4, type: "table" }]);
    expect(chunks).toHaveLength(4);
    expect(chunks[1]).toMatchObject({ ordinal: 1, page: 3, blockIndex: 0, startOffset: CHUNK_SIZE - CHUNK_OVERLAP });
    expect(chunks.at(-1)).toMatchObject({ page: 4, blockIndex: 1, text: "table evidence" });
    for (const chunk of chunks.slice(0, -1)) expect(chunk.text).toBe(text.slice(chunk.startOffset, chunk.endOffset));
    expect(chunks[0].textSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(chunkParsedDocument("unused", [{ text, page: 3, type: "text" }])[0].textSha256).toBe(chunks[0].textSha256);
  });
  it("uses Markdown with no invented page when blocks are unavailable", () => {
    expect(chunkParsedDocument("synthetic markdown", null)[0]).toMatchObject({ page: null, blockIndex: null, text: "synthetic markdown" });
    expect(chunkParsedDocument("", [])).toEqual([]);
  });
  it("does not split UTF-16 surrogate pairs", () => {
    const text = "a".repeat(1999) + "😀".repeat(1100);
    for (const chunk of chunkParsedDocument(text, null)) {
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      expect(chunk.text).toBe(text.slice(chunk.startOffset, chunk.endOffset));
    }
  });
});
