import { prisma } from "@/lib/prisma";
import { assistantHttp } from "@/modules/ai/assistant/http";
import { activeActor, projects } from "@/modules/ai/assistant/repositories";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return assistantHttp(request, async user => Response.json({ data: await projects(prisma, await activeActor(prisma, user.id)) }, { headers: { "Cache-Control": "no-store" } }));
}
