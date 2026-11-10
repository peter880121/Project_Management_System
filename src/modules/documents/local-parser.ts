import { documentFormat } from "./formats";
import { readDocx } from "./docx";
import { decodeDocumentText } from "./text-decoding";
import { mineruModel, ParseError } from "./mineru";
export function documentParser(filename: string) {
  const format = documentFormat(filename);
  if (!format) throw new ParseError("DOCUMENT_FORMAT_UNSUPPORTED");
  return format.cloud ? { provider: "mineru-cloud-v4", modelVersion: mineruModel(), phase: "RESERVE", cloud: true } : { provider: "local-document-v1", modelVersion: format.extension === "docx" ? "docx-text-v1" : "unicode-text-v1", phase: "LOCAL", cloud: false };
}
export function parseLocalDocument(filename: string, bytes: Uint8Array) {
  try {
    const format = documentFormat(filename);
    if (!format || format.cloud) throw new Error("format");
    if (format.extension === "docx") return readDocx(bytes);
    const markdown = decodeDocumentText(bytes).trim();
    if (markdown.length > 2_000_000) throw new ParseError("DOCUMENT_TEXT_LIMIT");
    const blocks = markdown.split(/\n\s*\n/).filter(text => text.trim()).map(text => ({ text, page: null, type: format.extension === "md" && /^#{1,6}\s/.test(text) ? "heading" : "text" }));
    if (blocks.length > 20000) throw new ParseError("DOCUMENT_TEXT_LIMIT");
    return { markdown, blocks };
  } catch (error) { throw error instanceof ParseError ? error : new ParseError("DOCUMENT_LOCAL_PARSE_INVALID"); }
}
