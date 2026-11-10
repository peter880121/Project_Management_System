import { z } from "zod";
import {
  collectWeekly,
  exportWeekly,
  reviseWeekly,
  reviewWeekly,
  submitWeekly,
} from "@/modules/weekly-reports/services";
import { weeklyHttp } from "@/modules/weekly-reports/http";
type Context = { params: Promise<{ reportId: string; operation: string }> };
export const POST = (request: Request, context: Context) =>
  weeklyHttp(request, async (actor) => {
    const params = await context.params;
    const id = z.uuid().parse(params.reportId);
    const operation = z
      .enum(["collect", "submit", "review", "export", "revise"])
      .parse(params.operation);
    if (operation === "export")
      return Response.json(await exportWeekly(id, actor), {
        headers: {
          "Content-Disposition": `attachment; filename="weekly-report-${id}.json"`,
        },
      });
    if (operation === "collect")
      return Response.json(await collectWeekly(id, actor));
    if (operation === "revise")
      return Response.json(await reviseWeekly(id, await request.json(), actor));
    return Response.json(
      await (operation === "submit"
        ? submitWeekly(id, await request.json(), actor)
        : reviewWeekly(id, await request.json(), actor)),
    );
  });
