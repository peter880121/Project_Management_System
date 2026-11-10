import { actorHttp } from "@/modules/http/actor-http";
import { captureDecisionSnapshots } from "@/modules/dashboard/decision-service";
export const POST = (request: Request) =>
  actorHttp(request, async (actor) =>
    Response.json(await captureDecisionSnapshots(actor.actorId, actor)),
  );
