export const projectStatuses = {
  PENDING_ACCEPTANCE: { label: "待验收", color: "border-amber-200 bg-amber-50 text-amber-800" },
  ARCHIVED: { label: "已归档", color: "border-slate-300 bg-slate-100 text-slate-700" },
  PLANNING: { label: "规划中", color: "border-sky-200 bg-sky-50 text-sky-800" },
  ACTIVE: { label: "进行中", color: "border-teal-200 bg-teal-50 text-teal-800" },
  ON_HOLD: { label: "已暂停", color: "border-amber-200 bg-amber-50 text-amber-800" },
  COMPLETED: { label: "已完成", color: "border-slate-200 bg-slate-100 text-slate-700" },
} as const;
