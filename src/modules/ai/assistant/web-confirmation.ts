import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ProjectError } from "@/modules/projects/services";
import { hasProjectTerms } from "./routing";
export type WebBinding = { actorId: string; actorRole: string; conversationId: string; projectId: string | null; expectedVersion: number; requestKey: string; question: string; mode: "WEB" };
const claimsSchema = z.object({ version: z.literal(1), digest: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive() }).strict();
function secret() { const value = process.env.SESSION_SECRET; if (!value || Buffer.byteLength(value) < 32) throw new ProjectError("外发确认签名配置不可用，请联系管理员", 503); return value; }
const digest = (binding: WebBinding) => createHash("sha256").update(JSON.stringify(binding)).digest("hex");
export const externalQuery = (question: string) => question.normalize("NFKC").trim();
export function assertExternalInput(question: string) {
  if (Array.from(externalQuery(question)).length > 400) throw new ProjectError("联网搜索词过长，请精简到 400 字以内", 400);
  if (/身份证|住院号|病历号|患者姓名|api[_ -]?key\s*[:=]|bearer\s+[a-z\d._-]+|(?:密码|口令|密钥)\s*[:：=]/i.test(question)) throw new ProjectError("请先移除患者标识或访问凭证，再发起联网搜索", 400);
}
export type SearchConfirmation = { query: string; sensitive: boolean; message: string; token: string; expiresAt: number };
export class SearchConfirmationRequired extends Error {
  constructor(readonly confirmation: SearchConfirmation) { super(confirmation.message); }
}
export function requireWebConfirmation(binding: WebBinding, token: string | undefined, names: string[] = [], now = Date.now()): void {
  assertExternalInput(binding.question);
  if (!token) {
    const expiresAt = now + 5 * 60000; const encoded = Buffer.from(JSON.stringify({ version: 1, digest: digest(binding), expiresAt })).toString("base64url");
    const signature = createHmac("sha256", secret()).update(encoded).digest("base64url"); const sensitive = hasProjectTerms(binding.question, names);
    throw new SearchConfirmationRequired({ query: externalQuery(binding.question), sensitive, message: sensitive ? "您的问题包含项目专有名词，确认要向外网发送吗？" : "确认将以下搜索词发送至外部搜索引擎吗？", token: `${encoded}.${signature}`, expiresAt });
  }
  const parts = token.split(".");
  try {
    if (parts.length !== 2) throw new Error("Invalid token"); const expected = createHmac("sha256", secret()).update(parts[0]).digest(); const signature = Buffer.from(parts[1], "base64url");
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error("Invalid signature");
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
    if (claims.expiresAt <= now || claims.expiresAt > now + 5 * 60000 || claims.digest !== digest(binding)) throw new Error("Expired or mismatched confirmation");
  } catch { throw new ProjectError("联网确认已失效或问题已修改，请重新确认", 409); }
}
