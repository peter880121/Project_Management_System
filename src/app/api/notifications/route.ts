import { z } from "zod";
import { planningHttp } from "@/modules/planning/http";
import { getRiskNotifications } from "@/modules/ai/risk/notifications";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return planningHttp(["PM"], async (actor) => {
    const page = z.coerce.number().int().min(1).max(10000).safeParse(new URL(request.url).searchParams.get("page") ?? 1);
    if (!page.success) return Response.json({ error: "页码无效" }, { status: 400 });
    return Response.json(await getRiskNotifications(actor.id, page.data), { headers: { "Cache-Control": "no-store" } });
  });
}
