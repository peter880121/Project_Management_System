import { exemptWeekly } from "@/modules/weekly-reports/statistics";
import { weeklyHttp } from "@/modules/weekly-reports/http";
export const POST = (request: Request) =>
  weeklyHttp(request, async (actor) =>
    Response.json(await exemptWeekly(await request.json(), actor)),
  );
