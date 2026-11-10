"use client";
import { useEffect, useState } from "react";
type Stats = {
  rosterCaptured: boolean;
  reportedPeople: number;
  declaredHours: number;
  riskItems: number;
  pendingSections: number;
  required: number | null;
  missing: number | null;
  onTime: number | null;
  late: number | null;
  scope: string;
};
export function WeeklySummary({
  week,
  projectId,
  revision = 0,
  authorId,
  role,
}: {
  week: string;
  projectId?: string;
  revision?: number;
  authorId?: string;
  role?: string;
}) {
  const [data, setData] = useState<Stats>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError("");
    const q = new URLSearchParams({ week });
    if (projectId) q.set("projectId", projectId);
    if (authorId) q.set("authorId", authorId);
    if (role) q.set("role", role);
    fetch(`/api/weekly-reports/stats?${q}`, { signal: abort.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setData(result);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [week, projectId, revision, authorId, role]);
  if (error)
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"
      >
        周报统计暂不可用：{error}
      </div>
    );
  const cards = data
    ? [
        { label: "应报人数", value: data.required ?? "—" },
        { label: "已报人员", value: data.reportedPeople },
        { label: "未报人数", value: data.missing ?? "—" },
        {
          label: "准时 / 迟报",
          value: `${data.onTime ?? "—"} / ${data.late ?? "—"}`,
        },
        { label: "待阅分区", value: data.pendingSections },
        {
          label: "申报工时 / 问题项",
          value: `${data.declaredHours}h / ${data.riskItems}`,
        },
      ]
    : Array.from({ length: 6 }, (_, i) => ({
        label: `加载中 ${i + 1}`,
        value: "—",
      }));
  return (
    <section aria-label="周报统计" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-xl border bg-white p-4 shadow-sm ${!data ? "animate-pulse" : ""}`}
          >
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="mt-3 text-xl font-semibold tabular-nums text-teal-900">
              {c.value}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {data?.scope === "PROJECT_SECTIONS"
          ? "仅统计有权阅知的项目分区，不展示全局应报分母。"
          : !data?.rosterCaptured
            ? "该周尚无应报人员快照，不推算历史未报率。"
            : "应报人员按本周启用时的人员快照统计，豁免需说明并审计。"}{" "}
        工时为个人申报，不与任务累计工时相加；问题项仅表示周报中报告的问题。
      </p>
    </section>
  );
}
