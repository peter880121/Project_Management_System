import { actorHttp } from "@/modules/http/actor-http";
import { decisionData } from "@/modules/dashboard/decision-service";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  actorHttp(request, async (actor) =>
    Response.json(
      await decisionData(
        actor.actorId,
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    ),
  );
export const POST = (request: Request) =>
  actorHttp(request, async (actor) =>
    Response.json(
      await decisionData(actor.actorId, await request.json(), actor, true),
      {
        headers: {
          "Content-Disposition":
            "attachment; filename=decision-center-page.json",
        },
      },
    ),
  );
