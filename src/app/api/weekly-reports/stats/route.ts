import { weeklyStatistics } from "@/modules/weekly-reports/statistics";
import { weeklyHttp } from "@/modules/weekly-reports/http";
export const GET = (request: Request) =>
  weeklyHttp(request, async (actor) =>
    Response.json(
      await weeklyStatistics(
        Object.fromEntries(new URL(request.url).searchParams),
        actor.actorId,
      ),
    ),
  );
