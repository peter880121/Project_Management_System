const PRIVATE_TAGS = new Set(["internal", "think", "thinking", "analysis", "reasoning", "private", "chain_of_thought"]);

/** A bounded incremental lexer: never release a possible partial XML control tag. */
export class ControlTextCleaner {
  private buffer = "";
  private hidden: string[] = [];
  private warned = false;
  private cleaned() {
    if (!this.warned) { this.warned = true; console.warn("AI_CONTROL_TAGS_CLEANED"); }
  }
  push(chunk: string, resultBoundary = false): { text: string; result?: string } {
    this.buffer += chunk;
    let text = "";
    while (this.buffer) {
      const index = this.buffer.indexOf("<");
      if (index !== 0) {
        const end = index < 0 ? this.buffer.length : index;
        if (!this.hidden.length) text += this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end);
        continue;
      }
      if (this.buffer === "<" || this.buffer === "</") break;
      // Mathematical comparisons (e.g. "< 5") are ordinary text, not XML.
      if (this.buffer.length > 1 && !/^<\/?[A-Za-z_]/.test(this.buffer)) {
        if (!this.hidden.length) text += "<";
        this.buffer = this.buffer.slice(1); continue;
      }
      const end = this.buffer.indexOf(">");
      if (end < 0) {
        if (this.buffer.length > 512) throw new SyntaxError("Unterminated model control tag");
        break;
      }
      const raw = this.buffer.slice(0, end + 1);
      const tag = /^<(\/)?([A-Za-z_][\w:.-]*)(?:\s+[^<>]*?)?\s*(\/)?\s*>$/.exec(raw);
      if (!tag) throw new SyntaxError("Malformed model control tag");
      this.buffer = this.buffer.slice(end + 1);
      const name = tag[2].toLowerCase(); const closing = !!tag[1]; const selfClosing = !!tag[3];
      if (resultBoundary && name === "result_json" && !closing && !selfClosing && !this.hidden.length) {
        const result = this.buffer; this.buffer = ""; return { text, result };
      }
      this.cleaned();
      if (name === "public_preview" || name === "result_json") continue;
      if (this.hidden.length) {
        if (closing) {
          if (this.hidden.at(-1) !== name) throw new SyntaxError("Mismatched private model block");
          this.hidden.pop();
        } else if (!selfClosing) this.hidden.push(name);
      } else if (PRIVATE_TAGS.has(name)) {
        if (closing) throw new SyntaxError("Unexpected private model closing tag");
        if (!selfClosing) this.hidden.push(name);
      }
      if (this.hidden.length > 32) throw new SyntaxError("Model control nesting limit exceeded");
    }
    return { text };
  }
  finish() {
    if (this.buffer || this.hidden.length) throw new SyntaxError("Incomplete model control block");
  }
}

/** Clean generated JSON strings only; source evidence and immutable audit snapshots stay intact. */
export function cleanGeneratedValue(value: unknown): unknown {
  if (typeof value === "string") {
    const cleaner = new ControlTextCleaner(); const result = cleaner.push(value).text; cleaner.finish();
    return result;
  }
  if (Array.isArray(value)) return value.map(cleanGeneratedValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cleanGeneratedValue(child)]));
  return value;
}

export function assertCleanGeneratedValue(value: unknown): void {
  if (typeof value === "string" && /<\/?[A-Za-z_]|&lt;\/?(?:PUBLIC_PREVIEW|RESULT_JSON|internal|think|analysis|reasoning)\b/i.test(value)) throw new SyntaxError("Unclean generated text");
  if (Array.isArray(value)) value.forEach(assertCleanGeneratedValue);
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { assertCleanGeneratedValue(key); assertCleanGeneratedValue(child); }
}

/** Fail closed on poisoned source snapshots instead of rewriting their evidence/hash. */
export function assertNoControlMarkers(value: unknown): void {
  if (typeof value === "string" && /(?:<|&lt;)\s*\/?\s*(?:PUBLIC_PREVIEW|RESULT_JSON|internal|think|thinking|analysis|reasoning|private|chain_of_thought)\b/i.test(value)) throw new SyntaxError("Control marker in generation record");
  if (Array.isArray(value)) value.forEach(assertNoControlMarkers);
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { assertNoControlMarkers(key); assertNoControlMarkers(child); }
}
