import { createWeekly, weeklyList } from "@/modules/weekly-reports/services";
import { weeklyHttp } from "@/modules/weekly-reports/http";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  weeklyHttp(request, async (actor) =>
    Response.json(
      await weeklyList(
        Object.fromEntries(new URL(request.url).searchParams),
        actor,
      ),
    ),
  );
export const POST = (request: Request) =>
  weeklyHttp(request, async (actor) =>
    Response.json(await createWeekly(await request.json(), actor)),
  );
