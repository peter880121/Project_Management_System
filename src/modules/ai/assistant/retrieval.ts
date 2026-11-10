import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { embedDocumentText } from "@/modules/ai/embeddings";
import { searchAssistantVectors } from "@/modules/vector/documents";
import { assistantEvidence, type AssistantEvidence } from "@/modules/documents/rag-repositories";
import { contactSearchTerm } from "./contacts";
import { contacts } from "./repositories";
import type { Citation } from "./types";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const contactText = (value: { name: string; email: string }) => `${value.name}；内部账号邮箱：${value.email}；账号资料未维护电话，电话请以有权限的内部文档为准。`;
export type Retrieval = { citations: Citation[]; mode: string; degraded: boolean; reason: string | null; durationMs: number };
export type AssistantRetrievalAdapters = { embed: (query: string) => Promise<number[]>; search: typeof searchAssistantVectors; load: typeof assistantEvidence; timeoutMs?: number };
const production: AssistantRetrievalAdapters = { embed: embedDocumentText, search: searchAssistantVectors, load: assistantEvidence };
export async function retrieveInternal(actor: AuthenticatedUser, projectIds: string[], question: string, signal: AbortSignal, adapters = production): Promise<Retrieval> {
  const started = Date.now(); signal.throwIfAborted();
  const term = contactSearchTerm(question);
  const people = term ? await contacts(prisma, actor, projectIds, term) : [];
  signal.throwIfAborted();
  const citations: Citation[] = people.map((person, index) => ({ ordinal: index + 1, sourceType: "CONTACT", contactId: person.id, projectId: null, documentId: null, chunkId: null, version: null, page: null, title: `内部联系人 · ${person.name}`, snippet: contactText(person), contentSha256: digest(contactText(person)) }));
  // A maintained internal contact is the authoritative answer; do not ask a model to invent its details.
  if (citations.length && !/电话|手机|phone/i.test(question)) return { citations, mode: "internal-contacts", degraded: false, reason: null, durationMs: Date.now() - started };
  let hits: AssistantEvidence[] = []; let reason: string | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let expired = false;
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const abort = () => { expired = true; rejectAbort?.(signal.reason); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (projectIds.length) hits = await Promise.race([
      (async () => { const vector = await adapters.embed(question); if (expired || signal.aborted) return []; const ids = await adapters.search(projectIds, vector, actor.role); if (expired || signal.aborted) return []; return adapters.load({ projectIds, role: actor.role }, question, ids); })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("RETRIEVAL_TIMEOUT")); }, adapters.timeoutMs ?? 1800); }),
      new Promise<never>((_, reject) => { rejectAbort = reject; if (signal.aborted) reject(signal.reason); }),
    ]);
    if (!hits.length) reason = "VECTOR_NO_CURRENT_HITS";
  } catch { signal.throwIfAborted(); reason = expired ? "VECTOR_TIMEOUT" : "VECTOR_UNAVAILABLE"; }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  signal.throwIfAborted();
  if (reason && projectIds.length) hits = await adapters.load({ projectIds, role: actor.role }, question);
  signal.throwIfAborted();
  const perDoc = new Map<string, number>(); let contextLength = 0;
  for (const hit of hits) {
    if (digest(hit.text) !== hit.textSha256) continue;
    const count = perDoc.get(hit.documentId) ?? 0; if (count >= 3 || citations.length >= 8 || contextLength + hit.text.length > 12000) continue; perDoc.set(hit.documentId, count + 1); contextLength += hit.text.length;
    citations.push({ ordinal: citations.length + 1, sourceType: "DOCUMENT", projectId: hit.projectId, documentId: hit.documentId, chunkId: hit.id, contactId: null, version: hit.version, page: hit.page, title: `${hit.projectName} · ${hit.filename}`.slice(0, 255), snippet: hit.text, contentSha256: hit.textSha256 });
  }
  return { citations, mode: citations.length && citations.every(c => c.sourceType === "CONTACT") ? "internal-contacts" : reason ? "keyword" : "vector", degraded: reason !== null, reason, durationMs: Date.now() - started };
}
