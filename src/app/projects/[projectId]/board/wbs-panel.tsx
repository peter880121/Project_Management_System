"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type SuggestedTask = {
  id: string;
  output: { title?: string; description?: string; estimateHours?: number; suggestedRole?: string; dependencyTitles?: string[] };
  history: { id: string; title: string; description: string | null; actualHours: number; deliveryDays: number }[];
};

export function WbsPanel({ projectId, onAccepted }: { projectId: string; onAccepted: () => Promise<void> }) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<SuggestedTask[]>([]);
  const [request, setRequest] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [degraded, setDegraded] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/ai/wbs`);
    const payload = await response.json() as { data?: SuggestedTask[]; error?: string };
    if (response.ok) setSuggestions(payload.data || []);
    else setError(payload.error || "无法读取 WBS 建议");
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/projects/${projectId}/ai/wbs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, syntheticDataConfirmed: confirmed }) });
      const payload = await response.json() as { data?: SuggestedTask[]; manualFallback?: boolean; degraded?: boolean; message?: string; error?: string };
      if (!response.ok) { setError(payload.error || "无法生成 WBS 建议"); return; }
      setRequest(""); setConfirmed(false); setDegraded(Boolean(payload.degraded)); setSuggestions((current) => [...(payload.data || []), ...current]);
      setNotice(payload.message || "建议已生成并保存为待确认项目；正式任务尚未创建。");
    } catch {
      setError("AI 服务当前不可用，请稍后重试或手动创建任务。");
    } finally { setBusy(false); }
  }

  async function review(suggestionId: string, decision: "ACCEPTED" | "REJECTED") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/ai/wbs/${suggestionId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setError(payload.error || "无法处理此建议"); return; }
      setSuggestions((current) => current.filter((item) => item.id !== suggestionId));
      setNotice(decision === "ACCEPTED" ? "已采纳此任务建议，并创建正式任务。" : "已拒绝此任务建议。");
      if (decision === "ACCEPTED") { await onAccepted(); router.refresh(); }
    } catch {
      setError("保存审阅决定失败，请刷新后查看建议状态。");
    } finally { setBusy(false); }
  }

  return <section className="mt-8 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5" aria-label="WBS 分解 Agent">
    <h2 className="text-xl font-semibold">智能 WBS 分解</h2>
    <p className="mt-2 max-w-3xl text-sm text-slate-600">Agent 会参考本项目已完成任务的实际工时与交付时间。生成内容进入待确认列表，只有 PM 逐条采纳后才会建立正式任务。</p>
    <form onSubmit={generate} className="mt-4 space-y-3">
      <label htmlFor="wbs-request" className="block text-sm font-medium">需求描述</label>
      <textarea id="wbs-request" minLength={10} maxLength={8000} required rows={4} value={request} onChange={(event) => setRequest(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white p-3" placeholder="描述待拆解的软件交付需求、验收条件和约束……" />
      <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required className="mt-1"/><span>我确认输入仅包含合成数据，不含真实患者信息。此需求文本会发送给配置的模型服务。</span></label>
      <button disabled={busy || !confirmed} className="rounded-md bg-indigo-800 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-900 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "处理中…" : "生成 WBS 建议"}</button>
    </form>
    {error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}{degraded ? "（历史检索已降级为 MySQL 关键词匹配）" : ""}</p>}
    {suggestions.length > 0 && <div className="mt-5 space-y-4"><h3 className="font-semibold">待确认任务（可逐条采纳）</h3>{suggestions.map((suggestion) => <article key={suggestion.id} className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold">{suggestion.output.title}</h4><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{suggestion.output.description}</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-900">待 PM 确认</span></div>
      <p className="mt-3 text-sm text-slate-600">建议工时：{suggestion.output.estimateHours} 小时 · 建议角色：{suggestion.output.suggestedRole}</p>
      {(suggestion.output.dependencyTitles?.length ?? 0) > 0 && <p className="mt-2 text-sm text-slate-600">依赖任务：{suggestion.output.dependencyTitles?.join("、")}</p>}
      <div className="mt-4 rounded-md bg-slate-50 p-3"><h5 className="text-sm font-medium">依据的历史任务</h5>{suggestion.history.length === 0 ? <p className="mt-1 text-sm text-slate-500">没有找到包含实际工时的相似已完成任务；当前建议缺少本项目历史依据。</p> : <ul className="mt-2 space-y-2">{suggestion.history.map((historyTask) => <li key={historyTask.id} className="text-sm"><span className="font-medium">{historyTask.title}</span><span className="ml-2 text-slate-600">实际 {historyTask.actualHours} 小时 · 交付 {historyTask.deliveryDays} 天</span>{historyTask.description && <p className="mt-1 text-xs text-slate-500">{historyTask.description}</p>}</li>)}</ul>}</div>
      <div className="mt-4 flex gap-2"><button disabled={busy} onClick={() => void review(suggestion.id, "ACCEPTED")} className="rounded-md bg-teal-800 px-3 py-2 text-sm text-white disabled:opacity-50">采纳为任务</button><button disabled={busy} onClick={() => void review(suggestion.id, "REJECTED")} className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">拒绝</button></div>
    </article>)}</div>}
  </section>;
}
