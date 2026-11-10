import { describe, expect, it } from "vitest";
import { decisionDates, decisionQuerySchema } from "./decision-schema";
describe("decision query contract", () => {
  it("uses an inclusive HK date range as a half-open UTC interval", () => {
    const range = decisionDates({ from: "2026-10-01", to: "2026-10-31" });
    expect(range.start.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(new Date("2026-10-31T15:59:59.999Z").getTime()).toBeLessThan(
      range.end.getTime(),
    );
    expect(new Date("2026-10-31T16:00:00.000Z").getTime()).toBe(
      range.end.getTime(),
    );
  });
  it.each(["2026-02-30", "2026-13-01"])("rejects an invalid date %s", (from) =>
    expect(decisionQuerySchema.safeParse({ from }).success).toBe(false),
  );
  it("rejects foreign states, arbitrary filters and inverted dates", () => {
    expect(
      decisionQuerySchema.safeParse({ dimension: "tasks", status: "ARCHIVED" })
        .success,
    ).toBe(false);
    expect(
      decisionQuerySchema.safeParse({ from: "2026-11-01", to: "2026-10-01" })
        .success,
    ).toBe(false);
    expect(decisionQuerySchema.safeParse({ sql: "SELECT *" }).success).toBe(
      false,
    );
  });
  it("defaults a person's responsibility drilldown to current work, preserving global and historical queries", () => {
    const personId = "00000000-0000-4000-8000-000000000003";
    expect(
      decisionQuerySchema.parse({ dimension: "tasks", personId }),
    ).toMatchObject({ taskView: "CURRENT", taskSort: "FOLLOW_UP" });
    expect(decisionQuerySchema.parse({ dimension: "tasks" })).toMatchObject({
      taskView: "ALL",
      taskSort: "NEWEST",
    });
    expect(
      decisionQuerySchema.parse({
        dimension: "tasks",
        personId,
        relation: "HANDLED",
      }),
    ).toMatchObject({ taskView: "ALL", taskSort: "NEWEST" });
    expect(
      decisionQuerySchema.parse({
        dimension: "tasks",
        personId,
        taskView: "ALL",
        taskSort: "NEWEST",
      }),
    ).toMatchObject({ taskView: "ALL", taskSort: "NEWEST" });
  });
  it.each([{ taskView: "ARCHIVED" }, { taskSort: "DROP TABLE Task" }])(
    "rejects unsupported task controls %j",
    (input) => {
      expect(
        decisionQuerySchema.safeParse({ dimension: "tasks", ...input }).success,
      ).toBe(false);
    },
  );
});
