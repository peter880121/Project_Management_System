import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { getCurrentUser } from "@/modules/auth/session";
import type { AuthenticatedUser } from "@/modules/auth/rbac";
import { ProjectAccessError } from "@/modules/auth/project-access";
import { ProjectError } from "@/modules/projects/services";
import { SearchConfirmationRequired } from "./web-confirmation";
export async function assistantHttp(request: Request, action: (actor: AuthenticatedUser) => Promise<Response>) {
  try {
    const actor = await getCurrentUser(); if (!actor) return Response.json({ error: "请先登录", code: "UNAUTHORIZED" }, { status: 401 });
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      let originHost: string | null = null;
      try { originHost = origin ? new URL(origin).host : null; } catch { return Response.json({ error: "请求来源无效" }, { status: 403 }); }
      if (request.headers.get("sec-fetch-site") === "cross-site" || originHost && originHost !== (request.headers.get("host") ?? new URL(request.url).host)) return Response.json({ error: "不允许跨站请求" }, { status: 403 });
    }
    return await action(actor);
  } catch (error) {
    if (error instanceof SearchConfirmationRequired) return Response.json({ error: error.message, code: "EXTERNAL_SEARCH_CONFIRMATION_REQUIRED", confirmation: error.confirmation }, { status: 428, headers: { "Cache-Control": "no-store" } });
    if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: "输入无效，请检查问题和字段" }, { status: 400 });
    if (error instanceof ProjectAccessError || error instanceof ProjectError) return Response.json({ error: error.message, ...([401, 403].includes(error.status) ? { code: "UNAUTHORIZED" } : {}) }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2028", "P2034", "P2002"].includes(error.code)) return Response.json({ error: "系统繁忙或会话冲突，请刷新重试" }, { status: error.code === "P2002" ? 409 : 503 });
    console.error("RAG_ASSISTANT_OPERATION_FAILED"); return Response.json({ error: "知识助手暂时不可用，请稍后重试" }, { status: 503 });
  }
}
export async function readAssistantJson(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ProjectError("请使用 JSON 请求", 415);
  if (!request.body) throw new ProjectError("缺少请求内容", 400);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16384) { await reader.cancel(); throw new ProjectError("问题或请求内容过长，请精简后重试", 413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
