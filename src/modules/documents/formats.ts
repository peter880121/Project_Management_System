/** Shared with the browser; no storage, database or parser imports. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.text,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";
export const DOCUMENT_FORMAT_HELP = "PDF / DOCX 最大 20 MB；TXT / TEXT / MD 最大 5 MB";
export const DOCUMENT_MIME_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown"];
export function documentFormat(filename: string) {
  const extension = filename.trim().split(".").pop()?.toLowerCase();
  if (extension === "pdf") return { extension, mediaType: DOCUMENT_MIME_TYPES[0], maxBytes: MAX_DOCUMENT_BYTES, cloud: true };
  if (extension === "docx") return { extension, mediaType: DOCUMENT_MIME_TYPES[1], maxBytes: MAX_DOCUMENT_BYTES, cloud: false };
  if (extension === "txt" || extension === "text") return { extension, mediaType: DOCUMENT_MIME_TYPES[2], maxBytes: MAX_TEXT_BYTES, cloud: false };
  if (extension === "md") return { extension, mediaType: DOCUMENT_MIME_TYPES[3], maxBytes: MAX_TEXT_BYTES, cloud: false };
  return null;
}
export function uploadFileError(file: { name: string; size: number }) {
  const format = documentFormat(file.name);
  if (!format) return "仅支持 PDF、DOCX、TXT、TEXT、MD 文件";
  return file.size <= 0 || file.size > format.maxBytes ? `${format.extension.toUpperCase()} 文件须大于 0 且不超过 ${format.maxBytes / 1024 / 1024} MB` : null;
}
