import { expect, it } from "vitest";
import { dashboardScope, dashboardSqlScope } from "./scope";
import { parseDashboardQuery } from "./schemas";
it("intersects PM membership and requested project without promoting the filter to authorization", () => {
  expect(dashboardScope({ id: "pm", role: "PM" }, "foreign")).toEqual({ AND: [{ OR: [{ ownerId: "pm" }, { members: { some: { userId: "pm", active: true } } }] }, { id: "foreign" }] });
  const sql = dashboardSqlScope({ id: "pm", role: "PM" }, "foreign"); expect(sql.values).toEqual(["pm", "pm", "foreign"]); expect(sql.sql).not.toContain("foreign");
  expect(dashboardScope({ id: "qa", role: "QA" })).toEqual({ id: { in: [] } });
});
it("validates pagination, unknown and duplicated filters", () => {
  for (const query of ["healthPage=0", "loadPage=10001", "projectId=bad", "role=ADMIN", "healthPage=1&healthPage=2"]) expect(parseDashboardQuery(new URLSearchParams(query)).success).toBe(false);
  expect(parseDashboardQuery(new URLSearchParams()).success).toBe(true);
});
