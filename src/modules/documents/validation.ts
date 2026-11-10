import { createHash } from "node:crypto";
import { z } from "zod";
import { documentFormat, MAX_DOCUMENT_BYTES } from "./formats";
import { decodeDocumentText } from "./text-decoding";
import { readDocx } from "./docx";

export const MAX_PDF_BYTES = MAX_DOCUMENT_BYTES;
const MAX_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 64 * 1024;
export class DocumentError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export const documentId = (value: string) => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new DocumentError("ID 无效", 400);
  return parsed.data;
};
export function validatePdf(filename: string, mediaType: string, bytes: Uint8Array) {
  if (!z.string().trim().min(5).max(255).regex(/\.pdf$/i).refine((name) => !/[\x00-\x1f\x7f/\\]/.test(name)).safeParse(filename).success) throw new DocumentError("请上传名称合法的 PDF 文件", 400);
  if (mediaType !== "application/pdf") throw new DocumentError("仅支持 application/pdf", 415);
  if (!bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES) throw new DocumentError("PDF 需大于 0 且不超过 20 MB", 413);
  if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") throw new DocumentError("文件头不是 PDF", 415);
  return { filename: filename.trim(), mediaType: "application/pdf", fileSize: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}
export function validateDocument(filename: string, mediaType: string, bytes: Uint8Array) {
  filename = filename.trim();
  if (!z.string().min(1).max(255).refine(name => !/[\x00-\x1f\x7f/\\]/.test(name)).safeParse(filename).success) throw new DocumentError("文件名无效", 400);
  const format = documentFormat(filename);
  if (!format) throw new DocumentError("仅支持 PDF、DOCX、TXT、TEXT、MD 文件", 415);
  if (!bytes.byteLength || bytes.byteLength > format.maxBytes) throw new DocumentError(`文件须大于 0 且不超过 ${format.maxBytes / 1024 / 1024} MB`, 413);
  const declared = mediaType.split(";")[0].trim().toLowerCase();
  const allowed = [format.mediaType, "", "application/octet-stream", ...(format.extension === "md" ? ["text/plain", "text/x-markdown"] : [])];
  if (!allowed.includes(declared)) throw new DocumentError("文件类型与扩展名不一致", 415);
  try {
    if (format.extension === "pdf") validatePdf(filename, "application/pdf", bytes);
    else if (format.extension === "docx") readDocx(bytes);
    else decodeDocumentText(bytes);
  } catch (error) { if (error instanceof DocumentError) throw error; throw new DocumentError(format.extension === "docx" ? "DOCX 无效、损坏、加密、含不支持的内容或解压超限" : "文本编码或内容无效，请转换为 UTF-8 文本后上传", 415); }
  return { filename, mediaType: format.mediaType, fileSize: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}
export async function readUpload(request: Request) {
  const type = request.headers.get("content-type") || "";
  if (!type.startsWith("multipart/form-data;")) throw new DocumentError("需要 multipart 上传", 415);
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) throw new DocumentError("上传请求过大", 413);
  if (!request.body) throw new DocumentError("缺少上传内容", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new DocumentError("上传请求过大", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { "content-type": type } }).formData(); }
  catch { throw new DocumentError("上传格式无效", 400); }
  const entries = [...form.entries()];
  if (entries.length !== 3 || new Set(entries.map(([key]) => key)).size !== 3 || entries.some(([key]) => !["file", "uploadKey", "syntheticOnly"].includes(key))) throw new DocumentError("上传字段无效", 400);
  const file = form.get("file");
  if (!(file instanceof File) || form.get("syntheticOnly") !== "true") throw new DocumentError("请选择文件并确认仅含合成数据", 400);
  const uploadKey = documentId(String(form.get("uploadKey")));
  const bytes = Buffer.from(await file.arrayBuffer());
  return { ...validateDocument(file.name, file.type, bytes), bytes, uploadKey };
}
