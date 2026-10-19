export const DASHBOARD_TIMEZONE = "Asia/Hong_Kong";
const offset = 8 * 60 * 60 * 1000;
export function sixMonthWindows(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid dashboard date");
  const local = new Date(now.getTime() + offset);
  return Array.from({ length: 6 }, (_, index) => {
    const month = local.getUTCMonth() - 5 + index;
    const start = new Date(Date.UTC(local.getUTCFullYear(), month, 1) - offset);
    const end = new Date(Date.UTC(local.getUTCFullYear(), month + 1, 1) - offset);
    const labelDate = new Date(start.getTime() + offset);
    return { month: `${labelDate.getUTCFullYear()}-${String(labelDate.getUTCMonth() + 1).padStart(2, "0")}`, start, end };
  });
}
