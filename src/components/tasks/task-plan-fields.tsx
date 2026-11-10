"use client";
import { useState } from "react";
import { PROJECT_PHASES } from "@/modules/projects/task-phases";
import { businessToday } from "@/modules/tasks/plan";

export function taskPlanFormValues(values: FormData) {
  return { phase: String(values.get("phase") || ""), estimateHours: Number(values.get("estimateHours")), plannedStartDate: String(values.get("plannedStartDate") || "") || null, dueDate: String(values.get("dueDate") || "") || null };
}
export function TaskPlanFields({ defaultPhase = "", defaultDueDate, dueDateRequired = true }: { defaultPhase?: string; defaultDueDate?: string; dueDateRequired?: boolean }) {
  const [choice, setChoice] = useState(defaultPhase && !PROJECT_PHASES.includes(defaultPhase) ? "CUSTOM" : defaultPhase);
  const [custom, setCustom] = useState(defaultPhase && !PROJECT_PHASES.includes(defaultPhase) ? defaultPhase : "");
  return <fieldset className="space-y-4 rounded-xl border border-teal-200 bg-teal-50/50 p-4"><legend className="px-2 text-sm font-semibold text-teal-900">计划信息</legend>
    <input type="hidden" name="phase" value={choice === "CUSTOM" ? custom : choice} />
    <label className="block space-y-2 text-sm">所属阶段 <span className="text-red-700">*</span><select required aria-label="所属阶段" value={choice} onChange={e => setChoice(e.target.value)} className="block w-full rounded-lg border border-slate-300 bg-white p-2.5"><option value="">请选择阶段</option>{PROJECT_PHASES.map(phase => <option key={phase} value={phase}>{phase}</option>)}<option value="CUSTOM">自定义阶段</option></select></label>
    {choice === "CUSTOM" && <label className="block space-y-2 text-sm">自定义阶段<input required aria-label="自定义阶段" maxLength={50} value={custom} onChange={e => setCustom(e.target.value)} className="block w-full rounded-lg border border-slate-300 bg-white p-2.5" /></label>}
    <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-sm">预计工时（小时） <span className="text-red-700">*</span><input required name="estimateHours" aria-label="预计工时" type="number" min="0.01" max="10000" step="0.01" placeholder="例如：8" className="block w-full rounded-lg border border-slate-300 bg-white p-2.5" /></label><label className="block space-y-2 text-sm">预计完成日期 {dueDateRequired && <span className="text-red-700">*</span>}<input required={dueDateRequired} name="dueDate" aria-label="预计完成日期" type="date" min="2000-01-01" max="2100-12-31" defaultValue={defaultDueDate ?? businessToday()} className="block w-full rounded-lg border border-slate-300 bg-white p-2.5" /></label></div>
    <label className="block space-y-2 text-sm">预计开始日期（可稍后排期）<input name="plannedStartDate" aria-label="预计开始日期" type="date" min="2000-01-01" max="2100-12-31" className="block w-full rounded-lg border border-slate-300 bg-white p-2.5" /></label>
    <p className="text-xs leading-6 text-slate-600">未填写完整计划日期时，任务标记为“待排期”，保留在排期列表中。实际完成日期与实际工时在完成签署时单独填写。</p>
  </fieldset>;
}
