"use client";
import { useState, type FormEvent } from "react";
import type { ComplianceFinding, ComplianceSummary } from "@/modules/ai/compliance-audit/types";
import { Button } from "@/components/ui/button";

export type SavedSummary = { summaryId: string; status: string; degraded: boolean; summary: ComplianceSummary; findings: ComplianceFinding[]; scannedAt: string; coverage: { complete: boolean; tasks: number; requirements: number; testCases: number; auditLogsTruncated: boolean }; findingReviews?: { findingKey: string; decision: string; note: string; reviewedById: string; createdAt: string }[] };
export function CompliancePanel({ initial, canReview }: { initial: SavedSummary; canReview: boolean }) {
  const [summary, setSummary] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>, findingKey?: string) {
    event.preventDefault(); setBusy(true); setMessage("");
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const url = `/api/audit/summaries/${summary.summaryId}${findingKey ? `/findings/${encodeURIComponent(findingKey)}/review` : ""}`;
      const response = await fetch(url, { method: findingKey ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "复核失败");
      if (findingKey) setSummary((old) => ({ ...old, findingReviews: [...(old.findingReviews || []), result.data] }));
      else setSummary((old) => ({ ...old, status: result.data.status }));
      setMessage("复核已保存并记录审计。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(false); }
  }
  return <section aria-label="合规审计摘要" className="my-6 space-y-4 rounded-xl border border-teal-200 bg-teal-50 p-5">
    <h2 className="text-xl font-semibold">合规审计摘要 · {summary.status}</h2>
    <p className="text-sm">扫描 ID：{summary.summaryId} · {summary.scannedAt} {summary.degraded && "· 规则降级"}</p>
    <p className="text-sm">当前业务快照：{summary.coverage.tasks} 项任务、{summary.coverage.requirements} 项需求、{summary.coverage.testCases} 项测试。时间和操作人筛选仅用于审计事件。</p>
    {!summary.coverage.complete && <p role="alert" className="font-semibold text-red-800">扫描覆盖不完整，需要补查；不能据此判定全部通过。</p>}
    {summary.coverage.auditLogsTruncated && <p>审计来源仅取最新 100 条，部分证据需要另行查询。</p>}
    <p>{summary.summary.overview}</p>
    <p className="text-sm">采纳摘要表示认可本次结论，不代表项目已合规或允许发布。问题复核不会自动整改业务数据。</p>
    <fieldset disabled={busy} className="space-y-4">
      {summary.status === "PENDING" && canReview && <form onSubmit={(event) => void submit(event)} className="space-y-2 rounded border bg-white p-3">
        <label className="block">摘要决定<select aria-label="摘要决定" name="decision" className="ml-3 rounded border p-2"><option value="ACCEPTED">采纳</option><option value="REJECTED">拒绝</option></select></label>
        <label className="block">摘要复核说明<textarea aria-label="摘要复核说明" name="note" required maxLength={2000} className="block w-full rounded border p-2" /></label><Button>提交摘要复核</Button>
      </form>}
      <h3 className="font-semibold">规则发现（{summary.findings.length}）</h3>
      {summary.findings.length === 0 && <p>本次范围内未发现规则问题；仍需人工复核。</p>}
      {summary.findings.map((finding) => {
        const reviewed = summary.findingReviews?.find((row) => row.findingKey === finding.findingKey);
        return <article key={finding.findingKey} className="space-y-2 rounded border bg-white p-4"><h4 className="font-semibold">{finding.code}</h4><p>{finding.summary}</p><p className="text-xs">需求版本：{finding.requirementVersion ?? "无关联需求"}</p>
          <p className="break-all text-xs">业务记录：{finding.recordIds.join(", ")}</p>
          {finding.sourceAuditMissing && <p className="text-sm text-amber-800">当前审计筛选范围内缺少来源记录，请补查。</p>}
          {finding.auditIds.map((id) => <a key={id} href={`/audit/records/${id}`} className="mr-3 break-all text-xs text-teal-800 underline">审计记录 {id}</a>)}
          {reviewed ? <p className="text-sm">{reviewed.decision} · {reviewed.note} · {reviewed.reviewedById} · {reviewed.createdAt}</p> : canReview && <form className="space-y-2" onSubmit={(event) => void submit(event, finding.findingKey)}><label>问题结论<select aria-label="问题结论" name="decision" className="ml-3 rounded border p-2"><option value="CONFIRMED">确认问题</option><option value="DISMISSED">说明误报</option></select></label><label className="block">问题复核说明<textarea aria-label="问题复核说明" name="note" required maxLength={2000} className="block w-full rounded border p-2" /></label><Button>提交问题复核</Button></form>}
        </article>;
      })}
    </fieldset>
    <h3 className="font-semibold">解释性摘要</h3>
    {[...summary.summary.keyChanges, ...summary.summary.anomalies, ...summary.summary.reviewItems].map((item, index) => <p key={index}>{item.summary} {item.auditIds.map((id) => <a key={id} className="text-teal-800 underline" href={`/audit/records/${id}`}>{id}</a>)}</p>)}
    {message && <p role="status">{message}</p>}
  </section>;
}
export function SummaryHistory({ projectId, canReview }: { projectId: string; canReview: boolean }) {
  const [rows, setRows] = useState<{ id: string; status: string; createdAt: string }[]>([]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SavedSummary | null>(null);
  const [message, setMessage] = useState("");
  async function load(nextPage: number) {
    setMessage("");
    try {
      const response = await fetch(`/api/audit/summaries?projectId=${encodeURIComponent(projectId.trim())}&page=${nextPage}`);
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setRows(result.data); setPage(nextPage); setSelected(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "查询失败"); }
  }
  async function open(id: string) {
    try {
      const response = await fetch(`/api/audit/summaries/${id}`);
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      const row = result.data; setSelected({ ...row.output, summaryId: row.id, status: row.status, findingReviews: row.findingReviews });
    } catch (error) { setMessage(error instanceof Error ? error.message : "查询失败"); }
  }
  return <section className="my-4 space-y-3"><Button type="button" onClick={() => void load(1)}>查询历史摘要</Button><p>第 {page} 页</p><div className="flex gap-3"><Button disabled={page === 1} onClick={() => void load(page - 1)}>上一页</Button><Button disabled={rows.length < 20} onClick={() => void load(page + 1)}>下一页</Button></div>{rows.map((row) => <button key={row.id} className="block text-sm text-teal-800 underline" onClick={() => void open(row.id)}>{row.createdAt} · {row.status} · {row.id}</button>)}{message && <p role="alert">{message}</p>}{selected && <CompliancePanel key={selected.summaryId} initial={selected} canReview={canReview} />}</section>;
}
