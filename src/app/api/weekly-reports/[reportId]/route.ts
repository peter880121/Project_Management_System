import { z } from "zod";
import { saveWeekly, weeklyDetail } from "@/modules/weekly-reports/services";
import { weeklyHttp } from "@/modules/weekly-reports/http";
type Context = { params: Promise<{ reportId: string }> };
export const GET = (request: Request, context: Context) =>
  weeklyHttp(request, async (actor) =>
    Response.json(
      await weeklyDetail(
        z.uuid().parse((await context.params).reportId),
        actor,
      ),
    ),
  );
export const PATCH = (request: Request, context: Context) =>
  weeklyHttp(request, async (actor) =>
    Response.json(
      await saveWeekly(
        z.uuid().parse((await context.params).reportId),
        await request.json(),
        actor,
      ),
    ),
  );
