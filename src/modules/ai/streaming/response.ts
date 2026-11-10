import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ProjectAccessError } from "@/modules/auth/project-access";
import { ProjectError } from "@/modules/projects/services";
import { prisma } from "@/lib/prisma";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { encodeEvent, type AiStreamEvent, type GenerationStream } from "./protocol";
import { WbsStructuredOutputError } from "../wbs/failure";
import { projectFreezeDetails } from "@/modules/projects/freeze";

export function wantsStream(request: Request) { return request.headers.get("accept")?.includes("text/event-stream") ?? false; }
export function generationId(request: Request) {
  const value = request.headers.get("x-generation-id") ?? randomUUID();
  if (!z.uuid().safeParse(value).success) throw new ProjectError("生成请求 ID 无效", 400);
  return value;
}
export function safeStreamError(error: unknown): Extract<AiStreamEvent, { event: "error" }> {
  const frozen = projectFreezeDetails(error);
  if (frozen) return { event: "error", data: { code: frozen.code, status: frozen.status, message: frozen.error, retryable: false } };
  if (error instanceof WbsStructuredOutputError) return { event: "error", data: { code: "MODEL_RESPONSE_INVALID", status: 422, message: error.message, retryable: false } };
  if (error instanceof ProjectAccessError || error instanceof ProjectError && [401, 403].includes(error.status)) return { event: "error", data: { code: "UNAUTHORIZED", status: error.status, message: "权限或会话已变化，已停止生成，请重新确认访问权限", retryable: false } };
  if (error instanceof ProjectError) return { event: "error", data: { code: error.status === 409 ? "SOURCE_CHANGED" : "BUSINESS_ERROR", status: error.status, message: error.message, retryable: true } };
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2028", "P2034"].includes(error.code)) return { event: "error", data: { code: "BUSY", status: 503, message: "系统繁忙，请重试", retryable: true } };
  return { event: "error", data: { code: "GENERATION_FAILED", status: 503, message: "生成未完成，请刷新待确认列表后重试", retryable: true } };
}

export function generationResponse(request: Request, input: { generationId: string; projectId?: string; actorId: string; taskId?: string; meetingId?: string; errorMessage?: string } & AuditRequestMetadata, run: (stream: GenerationStream) => Promise<unknown>): Response {
  const encoder = new TextEncoder(); const controller = new AbortController();
  let closed = false; let committed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const abort = () => controller.abort(new DOMException("Generation cancelled", "AbortError"));
  const cleanup = () => { clearInterval(heartbeat); clearTimeout(deadline); request.signal.removeEventListener("abort", abort); };
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const body = new ReadableStream<Uint8Array>({
    start(sink) {
      function send(value: AiStreamEvent) { if (!closed) sink.enqueue(encoder.encode(encodeEvent(value))); }
      send({ event: "start", data: { generationId: input.generationId, version: 1 } });
      heartbeat = setInterval(() => { if (!closed) sink.enqueue(encoder.encode(": heartbeat\n\n")); }, 10000);
      deadline = setTimeout(() => controller.abort(new Error("Generation deadline exceeded")), 90_000);
      void (async () => {
        try {
          controller.signal.throwIfAborted();
          const payload = await run({ generationId: input.generationId, signal: controller.signal, emit: send });
          committed = true;
          if (!controller.signal.aborted) { send({ event: "result", data: { generationId: input.generationId, payload } }); send({ event: "done", data: { outcome: "completed" } }); }
        } catch (error) {
          if (!(controller.signal.aborted && controller.signal.reason?.name === "AbortError")) { const failure = safeStreamError(error); if (failure.data.code === "GENERATION_FAILED" && input.errorMessage) failure.data.message = input.errorMessage; send(failure); send({ event: "done", data: { outcome: "failed" } }); }
        } finally {
          cleanup();
          if (!closed) { closed = true; sink.close(); }
          if (controller.signal.aborted && !committed) {
            try {
              await prisma.$transaction(tx => recordAudit(tx, { actorId: input.actorId, projectId: input.projectId, action: "AI_GENERATION_CANCELLED", entityType: "AiGeneration", entityId: input.generationId, after: { taskId: input.taskId ?? null, ...(input.meetingId ? { meetingId: input.meetingId } : {}), reason: controller.signal.reason?.name === "AbortError" ? "CLIENT_CANCELLED" : "DEADLINE_EXCEEDED" }, ip: input.ip, userAgent: input.userAgent }));
            } catch { console.warn("AI_GENERATION_CANCEL_AUDIT_UNAVAILABLE", { generationId: input.generationId }); }
          }
        }
      })();
    },
    cancel() { closed = true; abort(); cleanup(); },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no", "X-Generation-Id": input.generationId, Vary: "Accept" } });
}
