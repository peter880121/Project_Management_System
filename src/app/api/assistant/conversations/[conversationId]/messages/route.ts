import { z } from "zod";
import { assistantHttp, readAssistantJson } from "@/modules/ai/assistant/http";
import { questionSchema } from "@/modules/ai/assistant/types";
import { beginQuestion, answerQuestion } from "@/modules/ai/assistant/services";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { generationResponse } from "@/modules/ai/streaming/response";
import { getCurrentUser } from "@/modules/auth/session";
import { ProjectAccessError } from "@/modules/auth/project-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ conversationId: string }> };
export async function POST(request: Request, { params }: Context) {
  return assistantHttp(request, async user => {
    const id = z.uuid().parse((await params).conversationId); const input = questionSchema.parse(await readAssistantJson(request)); const actor = { actorId: user.id, ...getAuditRequestMetadata(request) };
    const begun = await beginQuestion(id, input, actor);
    return generationResponse(request, { generationId: input.requestKey, ...actor, errorMessage: "回答未完成，请刷新对话核实后重试" }, stream => answerQuestion(begun, input.question, actor, stream, undefined, async () => {
      const current = await getCurrentUser(); if (!current || current.id !== user.id || current.role !== user.role) throw new ProjectAccessError("会话已失效", 401);
    }));
  });
}
