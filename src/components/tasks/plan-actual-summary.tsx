import { dateLabel } from "@/modules/tasks/plan";
export type TaskMetrics = { status: string; estimateHours?: string | number | null; actualHours?: string | number | null; plannedStartDate?: string | null; dueDate?: string | null; completedAt?: string | null; createdAt?: string; planningStatus?: string };
export function PlanActualSummary({ task }: { task: TaskMetrics }) {
  const done = task.status === "DONE";
  const effort = done && task.estimateHours != null && task.actualHours != null ? Number(task.actualHours) - Number(task.estimateHours) : null;
  const days = done && task.dueDate && task.completedAt ? Math.round((Date.parse(`${dateLabel(task.completedAt)}T00:00:00.000Z`) - Date.parse(`${dateLabel(task.dueDate)}T00:00:00.000Z`)) / 86400000) : null;
  const cell = (label: string, value: string) => <div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-sm font-medium text-slate-800">{value}</dd></div>;
  return <div className="space-y-3"><section aria-label="计划信息" className="rounded-xl border border-teal-100 bg-teal-50/60 p-4"><h4 className="mb-3 text-sm font-semibold text-teal-900">计划信息 <span className="ml-2 text-xs font-normal">{task.planningStatus === "SCHEDULED" ? "已排期" : "待排期"}</span></h4><dl className="grid grid-cols-2 gap-4">{cell("预计工时", task.estimateHours == null ? "未填写" : `${task.estimateHours} 小时`)}{cell("预计完成日期", dateLabel(task.dueDate))}{cell("预计开始日期", dateLabel(task.plannedStartDate))}</dl></section>
    <section aria-label="实际信息" className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h4 className="mb-3 text-sm font-semibold">实际信息</h4><dl className="grid grid-cols-2 gap-4">{cell("实际工时", done && task.actualHours != null ? `${task.actualHours} 小时` : "未记录")}{cell("实际完成日期", done ? dateLabel(task.completedAt) : "未完成")}{done && cell("工时偏差（实际 − 预计）", effort === null ? "计划缺失，无法比较" : `${effort > 0 ? "+" : ""}${Number(effort.toFixed(2))} 小时`)}{done && cell("日期偏差（实际 − 预计）", days === null ? "计划缺失，无法比较" : `${days > 0 ? "+" : ""}${days} 天`)}</dl></section>
    {task.createdAt && <p className="text-xs text-slate-500">创建日期：{dateLabel(task.createdAt)} · 系统记录</p>}
  </div>;
}
