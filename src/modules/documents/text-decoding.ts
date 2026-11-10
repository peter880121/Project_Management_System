/** Decode explicitly supported Unicode encodings; never replace invalid bytes with U+FFFD. */
export function decodeDocumentText(bytes: Uint8Array) {
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
  if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || /^\s*(?:%PDF-|PK\x03\x04|\{\\rtf)/.test(text)) throw new Error("DOCUMENT_TEXT_INVALID");
  return text;
}
