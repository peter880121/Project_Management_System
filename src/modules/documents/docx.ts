import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

type XmlNode = { [key: string]: unknown };
export function readDocx(bytes: Uint8Array) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new Error("DOCX_INVALID");
  let count = 0, total = 0;
  const seen = new Set<string>();
  const entries = unzipSync(bytes, { filter: file => {
    if (++count > 512 || seen.has(file.name) || file.name.startsWith("/") || file.name.includes("\\") || file.name.split("/").includes("..")) throw new Error("DOCX_ARCHIVE_INVALID");
    seen.add(file.name); total += file.originalSize;
    if (total > 40 * 1024 * 1024 || file.originalSize > 20 * 1024 * 1024) throw new Error("DOCX_ARCHIVE_LIMIT");
    if (/vbaProject|^word\/embeddings\//i.test(file.name)) throw new Error("DOCX_ACTIVE_CONTENT");
    const selected = ["[Content_Types].xml", "word/document.xml", "_rels/.rels"].includes(file.name) || /\.rels$/.test(file.name);
    if (selected && file.originalSize > 8 * 1024 * 1024) throw new Error("DOCX_XML_LIMIT");
    return selected;
  } });
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, removeNSPrefix: true, processEntities: false, parseTagValue: false, trimValues: false, ignoreDeclaration: true });
  function xml(name: string): XmlNode[] {
    if (!entries[name]) throw new Error("DOCX_STRUCTURE_INVALID");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(entries[name]);
    if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error("DOCX_XML_INVALID");
    return parser.parse(text) as XmlNode[];
  }
  const types = xml("[Content_Types].xml");
  const relationships = xml("_rels/.rels");
  const document = xml("word/document.xml");
  let nodes = 0;
  function visit(items: XmlNode[], callback: (name: string, children: XmlNode[], attrs: Record<string, string>) => void, depth = 0) {
    if (depth > 128) throw new Error("DOCX_DEPTH_LIMIT");
    for (const item of items) {
      if (++nodes > 200000) throw new Error("DOCX_NODE_LIMIT");
      for (const [name, value] of Object.entries(item)) if (name !== ":@" && name !== "#text" && Array.isArray(value)) {
        callback(name, value, (item[":@"] ?? {}) as Record<string, string>); visit(value, callback, depth + 1);
      }
    }
  }
  let validType = false, validRelationship = false;
  visit(types, (name, _children, attrs) => { if (name === "Override" && attrs["@_PartName"] === "/word/document.xml" && attrs["@_ContentType"] === "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") validType = true; });
  const checkRelationship = (name: string, _children: XmlNode[], attrs: Record<string, string>) => {
    if (name !== "Relationship") return;
    if (attrs["@_TargetMode"]?.toLowerCase() === "external" && !attrs["@_Type"]?.endsWith("/hyperlink")) throw new Error("DOCX_EXTERNAL_CONTENT");
    if (attrs["@_Type"]?.endsWith("/officeDocument") && ["word/document.xml", "/word/document.xml"].includes(attrs["@_Target"]) && attrs["@_TargetMode"] !== "External") validRelationship = true;
  };
  visit(relationships, checkRelationship);
  for (const name of Object.keys(entries)) if (/\.rels$/.test(name) && name !== "_rels/.rels") visit(xml(name), checkRelationship);
  if (!validType || !validRelationship || !document.some(node => Array.isArray(node.document))) throw new Error("DOCX_STRUCTURE_INVALID");
  const blocks: { text: string; type: string; page: null }[] = [];
  const decode = (value: string) => value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
    if (entity in named) return named[entity];
    const code = entity.startsWith("&#x") ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  });
  function content(items: XmlNode[], depth = 0): string {
    if (depth > 128) throw new Error("DOCX_DEPTH_LIMIT");
    return items.map(item => Object.entries(item).map(([name, value]) => {
      if (["del", "instrText", "drawing", "pict", "object", ":@"].includes(name)) return "";
      if (name === "#text") return decode(String(value));
      if (name === "tab") return "\t";
      if (name === "br" || name === "cr") return "\n";
      if (!Array.isArray(value)) return "";
      return content(value, depth + 1) + (name === "tc" ? "\t" : name === "p" ? "\n" : "");
    }).join("")).join("");
  }
  visit(document, name => { if (name === "altChunk") throw new Error("DOCX_ACTIVE_CONTENT"); });
  function collect(items: XmlNode[], depth = 0) {
    if (depth > 128) throw new Error("DOCX_DEPTH_LIMIT");
    for (const item of items) for (const [name, value] of Object.entries(item)) {
      if (!Array.isArray(value) || ["del", "drawing", "pict", "object"].includes(name)) continue;
      if (name === "tr") {
        const cells = value.flatMap((node: XmlNode) => Array.isArray(node.tc) ? [content(node.tc).trim()] : []);
        const text = cells.join("\t"); if (text.trim()) blocks.push({ text, type: "table", page: null });
      } else if (name === "p") {
        let heading = ""; visit(value, (tag, _nested, attrs) => { if (tag === "pStyle") heading = attrs["@_val"]?.match(/^Heading([1-6])$/i)?.[1] ?? ""; });
        const text = content(value).trim(); if (text) blocks.push({ text: heading ? `${"#".repeat(Number(heading))} ${text}` : text, type: heading ? "heading" : "paragraph", page: null });
      } else collect(value, depth + 1);
    }
  }
  collect(document);
  const markdown = blocks.map(block => block.text).join("\n\n");
  if (!markdown.trim() || markdown.length > 2_000_000 || blocks.length > 20000) throw new Error("DOCX_TEXT_LIMIT_OR_EMPTY");
  return { markdown, blocks };
}
