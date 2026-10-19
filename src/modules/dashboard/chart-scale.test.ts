import { expect, it } from "vitest";
import { chartMaximum, chartPoints, chartRatio } from "./chart-scale";
it.each([[], [0, 0, 0, 0, 0, 0], [1, 1000000, 2], [Number.MAX_VALUE, Number.MAX_VALUE / 2, 0], [NaN, Infinity, -1]].map(values => ({ values })))("keeps $values within finite SVG bounds", ({ values }) => {
  const max = chartMaximum(values); expect(Number.isFinite(max)).toBe(true); expect(max).toBeGreaterThanOrEqual(1);
  for (const value of values) { const ratio = chartRatio(value, max); expect(ratio).toBeGreaterThanOrEqual(0); expect(ratio).toBeLessThanOrEqual(1); }
  for (const point of chartPoints(values, max)) { expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true); expect(point.x).toBeGreaterThanOrEqual(52); expect(point.x).toBeLessThanOrEqual(928); expect(point.y).toBeGreaterThanOrEqual(40); expect(point.y).toBeLessThanOrEqual(204); }
});
it("renders all zeros on the baseline and ratios before multiplying prevent overflow", () => {
  expect(chartPoints([0, 0], 1).map(p => p.y)).toEqual([204, 204]);
  expect(chartRatio(Number.MAX_VALUE / 2, Number.MAX_VALUE)).toBe(.5);
});
