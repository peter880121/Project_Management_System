import { z } from "zod";
import { assistantHttp, readAssistantJson } from "@/modules/ai/assistant/http";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { conversationDetail, updateConversation } from "@/modules/ai/assistant/services";
import { conversationEditSchema } from "@/modules/ai/assistant/types";
type Context = { params: Promise<{ conversationId: string }> };
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: Context) {
  return assistantHttp(request, async user => {
    const id = z.uuid().parse((await params).conversationId); const raw = new URL(request.url).searchParams.get("beforeSequence"); const before = raw ? z.coerce.number().int().positive().parse(raw) : undefined;
    return Response.json({ data: await conversationDetail(id, user.id, before) }, { headers: { "Cache-Control": "no-store" } });
  });
}
export async function PATCH(request: Request, { params }: Context) {
  return assistantHttp(request, async user => Response.json({ data: await updateConversation(z.uuid().parse((await params).conversationId), conversationEditSchema.parse(await readAssistantJson(request)), { actorId: user.id, ...getAuditRequestMetadata(request) }) }));
}
