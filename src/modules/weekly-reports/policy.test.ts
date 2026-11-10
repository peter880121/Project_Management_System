import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  dateSchema,
  digest,
  hkToday,
  reviewSchema,
  saveSchema,
  visibleSections,
  weekWindow,
} from "./policy";
describe("weekly report policy", () => {
  it("uses half-open HK Monday boundaries across a month/year", () => {
    const w = weekWindow("2027-01-01");
    expect(w.label).toBe("2026-12-28");
    expect(w.start.toISOString()).toBe("2026-12-27T16:00:00.000Z");
    expect(w.end.toISOString()).toBe("2027-01-03T16:00:00.000Z");
    expect(w.deadline.toISOString()).toBe("2027-01-04T04:00:00.000Z");
  });
  it("switches weeks exactly at Monday midnight in HK", () => {
    expect(
      weekWindow(hkToday(new Date("2026-10-25T15:59:59.999Z"))).label,
    ).toBe("2026-10-19");
    expect(
      weekWindow(hkToday(new Date("2026-10-25T16:00:00.000Z"))).label,
    ).toBe("2026-10-26");
  });
  it.each(["2026-02-29", "2026-13-01", "2026-10-32", "2026-1-2"])(
    "rejects invalid calendar dates %s",
    (value) => expect(dateSchema.safeParse(value).success).toBe(false),
  );
  it("isolates project and nonproject sections", () => {
    const sections = [
      { projectId: "a" },
      { projectId: "b" },
      { projectId: null },
    ];
    expect(visibleSections(sections, false, false, new Set(["a"]))).toEqual([
      { projectId: "a" },
    ]);
    expect(visibleSections(sections, true, false, new Set())).toHaveLength(3);
    expect(visibleSections(sections, false, true, new Set())).toHaveLength(3);
  });
  it("rejects duplicate source work, duplicate sections and excessive declared hours", () => {
    const item = {
      kind: "COMPLETED",
      text: "Synthetic work",
      sourceId: randomUUID(),
      sourceType: "TASK",
      declaredHours: 100,
    };
    const section = {
      id: randomUUID(),
      projectId: randomUUID(),
      summary: "",
      items: [item, item],
    };
    expect(
      saveSchema.safeParse({ expectedVersion: 1, sections: [section] }).success,
    ).toBe(false);
    expect(
      saveSchema.safeParse({ expectedVersion: 1, sections: [section, section] })
        .success,
    ).toBe(false);
  });
  it("rejects unknown fields and a return without a meaningful reason", () => {
    expect(
      reviewSchema.safeParse({
        expectedVersion: 1,
        sectionId: randomUUID(),
        decision: "RETURNED",
        reason: "",
      }).success,
    ).toBe(false);
    expect(
      reviewSchema.safeParse({
        expectedVersion: 1,
        sectionId: randomUUID(),
        decision: "READ",
        reason: "已阅",
        actorId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it("ignores JSON object key reordering performed by MySQL", () => {
    expect(digest({ first: 1, nested: { b: 2, a: 1 } })).toBe(
      digest({ nested: { a: 1, b: 2 }, first: 1 }),
    );
  });
  it("hashes immutable evidence and detects content changes", () =>
    expect(digest({ summary: "original" })).not.toBe(
      digest({ summary: "changed" }),
    ));
});
