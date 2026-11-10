import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import { syntheticDocx } from "../../../tests/fixtures/docx";
import { validateDocument } from "./validation";
import { parseLocalDocument } from "./local-parser";
import { decodeDocumentText } from "./text-decoding";
import { MAX_TEXT_BYTES, uploadFileError } from "./formats";
describe("multi-format document validation and extraction", () => {
  it.each(["txt", "text", "md"])("accepts %s without a browser MIME and preserves original hash metadata", extension => {
    const bytes = Buffer.from("# 合成说明\n\nUTF-8 安全内容");
    expect(validateDocument(`说明.${extension}`, "", bytes)).toMatchObject({ fileSize: bytes.length, mediaType: extension === "md" ? "text/markdown" : "text/plain" });
    expect(parseLocalDocument(`说明.${extension}`, bytes).blocks.every(block => block.page === null)).toBe(true);
  });
  it("extracts DOCX headings, runs, paragraphs and table text without inventing pages", () => {
    const bytes = syntheticDocx(); expect(validateDocument("合成.DOCX", "application/octet-stream", bytes).mediaType).toContain("wordprocessingml");
    const result = parseLocalDocument("合成.docx", bytes); expect(result.markdown).toContain("# 合成需求规格"); expect(result.markdown).toContain("索引 & 保留证据"); expect(result.blocks.every(block => block.page === null)).toBe(true);
    expect(parseLocalDocument("表格.docx", syntheticDocx('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>行动项</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>负责人</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')).markdown).toMatch(/行动项[\s\S]*负责人/);
  });
  it("strictly decodes UTF-8 BOM and UTF-16 BOM, rejecting invalid bytes and binary payloads", () => {
    expect(decodeDocumentText(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("中文\r\n正文")]))).toBe("中文\n正文");
    expect(decodeDocumentText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("中文", "utf16le")]))).toBe("中文");
    expect(decodeDocumentText(Buffer.from([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]))).toBe("中文");
    for (const bytes of [Buffer.from([0xff, 0xf0]), Buffer.from("abc\x00def"), Buffer.from("%PDF-1.4"), syntheticDocx()]) expect(() => validateDocument("bad.txt", "text/plain", bytes)).toThrow();
  });
  it("rejects type spoofing, unsafe filenames and format-specific size limits", () => {
    expect(() => validateDocument("bad.md", "application/pdf", Buffer.from("hello"))).toThrow();
    for (const name of ["../bad.txt", "bad.doc", "bad.docm", "bad.png"]) expect(() => validateDocument(name, "", Buffer.from("hello"))).toThrow();
    expect(() => validateDocument("bad.txt", "text/plain", Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61))).toThrow();
    expect(uploadFileError({ name: "bad.md", size: MAX_TEXT_BYTES + 1 })).toContain("5 MB");
  });
  it("rejects ZIP impostors, invalid XML, DTD/entities, macros and external document resources", () => {
    const cases = [
      Buffer.from(zipSync({ "hello.txt": strToU8("not docx") })),
      syntheticDocx("", { "word/document.xml": strToU8("<broken>") }),
      syntheticDocx("", { "word/document.xml": strToU8('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///secret">]><w:document/>') }),
      syntheticDocx("", { "word/vbaProject.bin": strToU8("macro") }),
      syntheticDocx("", { "word/_rels/document.xml.rels": strToU8('<Relationships><Relationship TargetMode="External" Type="https://example.test/image" Target="http://127.0.0.1/a"/></Relationships>') }),
      syntheticDocx("", { "../escape.xml": strToU8("escape") }),
      syntheticDocx("", { "word/document.xml": strToU8("x".repeat(8 * 1024 * 1024 + 1)) }),
    ];
    for (const bytes of cases) expect(() => validateDocument("bad.docx", "", bytes)).toThrow();
  });
  it("keeps Markdown HTML inert as text rather than rendering or fetching it", () => {
    const source = '<script>alert("x")</script>\n\n![external](http://127.0.0.1/secret)';
    expect(parseLocalDocument("notes.md", Buffer.from(source)).markdown).toBe(source);
  });
});
