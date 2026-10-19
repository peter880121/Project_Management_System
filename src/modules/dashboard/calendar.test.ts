import { describe, expect, it } from "vitest";
import { sixMonthWindows } from "./calendar";
const offset = 8 * 3600000;
describe("Hong Kong calendar month boundaries converted to UTC", () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))("assigns month %i last second/millisecond and next midnight exactly once", month => {
    const midnight = Date.UTC(2026, month, 1) - offset;
    const windows = sixMonthWindows(new Date(Date.UTC(2026, month, 15)));
    const bucket = (time: number) => windows.filter(w => time >= w.start.getTime() && time < w.end.getTime());
    const previous = `2026-${String(month).padStart(2, "0")}`;
    const next = new Date(Date.UTC(2026, month, 1)).toISOString().slice(0, 7);
    for (const time of [midnight - 1000, midnight - 1]) { expect(bucket(time)).toHaveLength(1); expect(bucket(time)[0].month).toBe(previous); }
    for (const time of [midnight, midnight + 1]) { expect(bucket(time)).toHaveLength(1); expect(bucket(time)[0].month).toBe(next); }
    expect(bucket(midnight)[0].start.toISOString()).toBe(new Date(midnight).toISOString());
  });
  it("switches the current month at HK midnight while UTC remains on the previous day", () => {
    expect(sixMonthWindows(new Date("2026-09-30T15:59:59.999Z")).at(-1)?.month).toBe("2026-09");
    const october = sixMonthWindows(new Date("2026-09-30T16:00:00.000Z"));
    expect(october.at(-1)?.month).toBe("2026-10"); expect(october.at(-1)?.start.toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });
  it.each([2024, 2026])("handles leap-year month length and contiguous six-month windows in %i", year => {
    const windows = sixMonthWindows(new Date(`${year}-05-01T00:00:00+08:00`));
    expect(windows).toHaveLength(6);
    for (let i = 1; i < windows.length; i++) expect(windows[i - 1].end.getTime()).toBe(windows[i].start.getTime());
    const feb = windows.find(w => w.month === `${year}-02`)!;
    expect((feb.end.getTime() - feb.start.getTime()) / 86400000).toBe(year === 2024 ? 29 : 28);
  });
  it("rejects invalid dates", () => { expect(() => sixMonthWindows(new Date("invalid"))).toThrow(); });
});
