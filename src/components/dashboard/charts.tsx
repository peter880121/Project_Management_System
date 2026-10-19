"use client";
import { useId } from "react";
import { chartMaximum, chartPoints, chartRatio } from "@/modules/dashboard/chart-scale";
import type { DashboardStats } from "@/modules/dashboard/types";

export function ResourceLoadChart({ rows }: { rows: DashboardStats["workload"]["rows"] }) {
  const id = useId(); const max = chartMaximum(rows.map(r => r.count));
  return <div role="img" aria-label="成员未完成任务量柱状图" className="space-y-5">{rows.map(row => <div key={row.assigneeId} className="space-y-2">
    <div className="flex min-w-0 justify-between gap-3 text-sm"><span className="truncate font-medium text-slate-700" title={row.name}>{row.name}<span className="ml-2 text-xs font-normal text-slate-400">{row.role}</span></span><span className="shrink-0 font-semibold tabular-nums text-teal-900">{row.count.toLocaleString("zh-CN")} <span className="text-xs font-normal text-slate-400">项</span></span></div>
    <svg viewBox="0 0 1000 16" preserveAspectRatio="none" className="h-3 w-full overflow-hidden rounded-full" aria-hidden="true"><defs><linearGradient id={`${id}-${row.assigneeId}`}><stop className="[stop-color:theme(colors.teal.700)]"/><stop offset="100%" className="[stop-color:theme(colors.teal.400)]"/></linearGradient></defs><rect width="1000" height="16" rx="8" className="fill-slate-100"/><rect width={chartRatio(row.count, max) * 1000} height="16" rx="8" fill={`url(#${id}-${row.assigneeId})`} className="stroke-teal-700/10" strokeWidth="1"><title>{row.name}：{row.count} 项未完成任务</title></rect></svg>
  </div>)}</div>;
}
export function DeliveryTrendChart({ rows }: { rows: DashboardStats["trend"] }) {
  const id = useId(); const max = chartMaximum(rows.flatMap(r => [r.archivedProjects, r.deliverableVersions]));
  const series = [{ label: "归档项目", field: "archivedProjects" as const, color: "stroke-teal-700", dot: "fill-teal-700" }, { label: "交付物版本", field: "deliverableVersions" as const, color: "stroke-sky-500", dot: "fill-sky-500" }];
  return <>
    <div className="mb-3 flex flex-wrap items-center gap-5 text-xs text-slate-500"><span className="inline-flex items-center gap-2"><i className="h-2 w-5 rounded-full bg-teal-700"/>归档项目</span><span className="inline-flex items-center gap-2"><i className="h-2 w-5 rounded-full bg-sky-500"/>交付物版本</span><span className="ml-auto">单位：数量 · 香港自然月</span></div>
    <svg role="img" aria-label="近六个月交付趋势折线图" viewBox="0 0 980 250" className="block h-auto max-h-80 w-full overflow-hidden"><title>近六个月归档项目及交付物版本创建趋势</title><defs><linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop className="[stop-color:theme(colors.teal.400)]" stopOpacity=".22"/><stop offset="100%" className="[stop-color:theme(colors.teal.50)]" stopOpacity=".02"/></linearGradient></defs>
      {[0, .5, 1].map(ratio => <g key={ratio}><line x1="52" x2="928" y1={204 - ratio * 164} y2={204 - ratio * 164} className="stroke-slate-200" strokeDasharray="4 6"/><text x="42" y={208 - ratio * 164} textAnchor="end" className="fill-slate-400 text-[11px]">{(max * ratio).toLocaleString("zh-CN", { maximumFractionDigits: 1, notation: max >= 100000 ? "compact" : "standard" })}</text></g>)}
      {series.map((s, index) => { const points = chartPoints(rows.map(r => r[s.field]), max); const path = points.map(p => `${p.x},${p.y}`).join(" "); return <g key={s.field}>
        {index === 0 && <polygon points={`52,204 ${path} 928,204`} fill={`url(#${id}-area)`}/>}
        <polyline points={path} fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={s.color}/>
        {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="5" className={`${s.dot} stroke-white`} strokeWidth="2"><title>{rows[i].month} · {s.label}：{rows[i][s.field]}</title></circle>)}
      </g>; })}
      {rows.map((r, i) => <text key={r.month} x={52 + i / Math.max(1, rows.length - 1) * 876} y="236" textAnchor="middle" className="fill-slate-500 text-[12px]">{r.month}</text>)}
    </svg>
    <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer underline decoration-slate-300 underline-offset-4">查看趋势数据表</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-2">月份</th><th>归档项目数</th><th>交付物版本创建数</th></tr></thead><tbody>{rows.map(row => <tr key={row.month} className="border-t border-slate-100"><td className="p-2">{row.month}</td><td>{row.archivedProjects}</td><td>{row.deliverableVersions}</td></tr>)}</tbody></table></div></details>
  </>;
}
