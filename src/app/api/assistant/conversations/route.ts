import { z } from "zod";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { assistantHttp, readAssistantJson } from "@/modules/ai/assistant/http";
import { conversationCreateSchema } from "@/modules/ai/assistant/types";
import { createConversation, listConversations } from "@/modules/ai/assistant/services";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return assistantHttp(request, async user => {
    const page = z.coerce.number().int().min(1).max(10000).parse(new URL(request.url).searchParams.get("page") ?? 1);
    return Response.json({ data: await listConversations(user.id, page) }, { headers: { "Cache-Control": "no-store" } });
  });
}
export async function POST(request: Request) {
  return assistantHttp(request, async user => {
    const input = conversationCreateSchema.parse(await readAssistantJson(request));
    return Response.json({ data: await createConversation(input.projectId, { actorId: user.id, ...getAuditRequestMetadata(request) }) }, { status: 201 });
  });
}
