export const safeValue = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;
export function chartMaximum(values: number[]) { return Math.max(1, ...values.map(safeValue)); }
export function chartRatio(value: number, maximum: number) {
  return Math.max(0, Math.min(1, safeValue(value) / Math.max(1, safeValue(maximum))));
}
export function chartPoints(values: number[], maximum: number) {
  return values.map((value, index) => ({ x: 52 + index / Math.max(1, values.length - 1) * 876, y: 204 - chartRatio(value, maximum) * 164 }));
}
