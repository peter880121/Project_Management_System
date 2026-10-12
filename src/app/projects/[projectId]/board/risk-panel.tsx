"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type RiskWarning = {
  id: string;
  createdAt: string;
  output: {
    taskId: string;
    taskTitle: string;
    severity: "HIGH" | "MEDIUM";
    evidence: string[];
    relatedTaskIds: string[];
    historicalDelayRate: number | null;
    historySampleSize: number;
  };
};

export function RiskPanel({ projectId }: { projectId: string }) {
  const [warnings, setWarnings] = useState<RiskWarning[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/ai/risk`);
      const payload = await response.json() as { data?: RiskWarning[]; error?: string };
      if (!response.ok) { setError(payload.error || "风险列表加载失败"); return; }
      setWarnings(payload.data || []);
    } catch { setError("风险服务暂时不可用。"); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function scan() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/projects/${projectId}/ai/risk`, { method: "POST" });
      const payload = await response.json() as { data?: RiskWarning[]; findingCount?: number; scannedTaskCount?: number; error?: string };
      if (!response.ok) { setError(payload.error || "风险扫描失败"); return; }
      await load();
      setNotice(`已扫描 ${payload.scannedTaskCount ?? 0} 个任务，发现 ${payload.findingCount ?? 0} 项风险。建议仍需 PM 处置，任务状态未被修改。`);
    } catch { setError("风险扫描失败，请稍后重试。"); }
    finally { setBusy(false); }
  }

  async function review(id: string, decision: "HANDLED" | "IGNORED") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/ai/risk/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setError(payload.error || "风险处置保存失败"); return; }
      setWarnings((current) => current.filter((warning) => warning.id !== id));
      setNotice(decision === "HANDLED" ? "风险已标记为已处理，操作已写入审计日志。" : "风险已忽略，操作已写入审计日志。");
    } catch { setError("风险处置保存失败，请刷新后重试。"); }
    finally { setBusy(false); }
  }

  return <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50/60 p-5" aria-label="风险预警 Agent">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">资源冲突与风险预警</h2><p className="mt-1 text-sm text-slate-600">扫描临近截止任务、成员并行负载、未完成前置任务和历史延期率。预警仅供决策参考，不会自动修改任务状态。</p></div><button type="button" disabled={busy} onClick={() => void scan()} className="rounded-md bg-amber-800 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-50">{busy ? "处理中…" : "扫描项目风险"}</button></div>
    {error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {warnings.length > 0 ? <div className="mt-4 space-y-3">{warnings.map((warning) => <article key={warning.id} className="rounded-lg border border-amber-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${warning.output.severity === "HIGH" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{warning.output.severity === "HIGH" ? "高风险" : "需关注"}</span><Link href={`/tasks/${warning.output.taskId}`} className="ml-2 font-semibold text-slate-900 hover:text-teal-800 hover:underline">{warning.output.taskTitle}</Link><span className="ml-2 text-xs text-slate-500">任务 ID：{warning.output.taskId}</span></div><span className="text-xs text-slate-500">待 PM 处置</span></div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">{warning.output.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul>
      {warning.output.relatedTaskIds.length > 0 && <p className="mt-2 text-xs text-slate-600">相关前置任务：{warning.output.relatedTaskIds.map((id) => <Link key={id} href={`/tasks/${id}`} className="ml-1 text-teal-800 underline">{id}</Link>)}</p>}
      <div className="mt-4 flex gap-2"><button type="button" disabled={busy} onClick={() => void review(warning.id, "HANDLED")} className="rounded-md bg-teal-800 px-3 py-2 text-sm text-white disabled:opacity-50">已处理</button><button type="button" disabled={busy} onClick={() => void review(warning.id, "IGNORED")} className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">忽略</button></div>
    </article>)}</div> : <p className="mt-4 rounded-md border border-dashed border-amber-300 p-4 text-center text-sm text-slate-600">当前没有待处置风险。点击“扫描项目风险”运行规则扫描。</p>}
  </section>;
}
