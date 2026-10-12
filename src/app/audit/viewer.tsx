"use client";

import { useState, type FormEvent } from "react";

type AuditRow = {
  id: string;
  projectId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actor?: { id: string; name: string; role: string };
};

type SummaryResult = {
  summaryId: string;
  degraded: boolean;
  summary: {
    overview: string;
    keyChanges: { summary: string; auditIds: string[] }[];
    anomalies: { summary: string; auditIds: string[]; recordIds: string[] }[];
    reviewItems: { summary: string; auditIds: string[]; recordIds: string[] }[];
  };
  auditLogs: AuditRow[];
};

function asIsoDate(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

export default function AuditLogViewer() {
  const [projectId, setProjectId] = useState("");
  const [actorId, setActorId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [message, setMessage] = useState("填写筛选条件后查询。最多显示 100 条最新记录。");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryItems = summary ? [
    ...summary.summary.keyChanges.map((item) => ({ ...item, heading: "关键变更", recordIds: [] as string[] })),
    ...summary.summary.anomalies.map((item) => ({ ...item, heading: "异常" })),
    ...summary.summary.reviewItems.map((item) => ({ ...item, heading: "待复查" })),
  ] : [];

  async function scan() {
    if (!projectId.trim()) { setMessage("生成合规摘要前请填写项目 ID。"); return; }
    setSummaryLoading(true);
    setSummary(null);
    const fromIso = asIsoDate(from);
    const toIso = asIsoDate(to);
    try {
      const response = await fetch("/api/audit/summary", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: projectId.trim(), ...(actorId.trim() ? { actorId: actorId.trim() } : {}), ...(fromIso ? { from: fromIso } : {}), ...(toIso ? { to: toIso } : {}) }),
      });
      const payload = await response.json() as SummaryResult & { error?: string };
      if (!response.ok) { setMessage(payload.error ?? "无法生成合规摘要。"); return; }
      setSummary(payload);
      setRows(payload.auditLogs);
      setMessage(payload.degraded ? "语言模型不可用，已返回规则扫描结果和原始审计记录。" : "合规摘要已生成并写入审计日志。");
    } catch {
      setMessage("审计服务暂时不可用，请稍后重试。");
    } finally { setSummaryLoading(false); }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const query = new URLSearchParams();
    if (projectId.trim()) query.set("projectId", projectId.trim());
    if (actorId.trim()) query.set("actorId", actorId.trim());
    if (action.trim()) query.set("action", action.trim());
    const fromIso = asIsoDate(from);
    const toIso = asIsoDate(to);
    if (fromIso) query.set("from", fromIso);
    if (toIso) query.set("to", toIso);

    try {
      const response = await fetch(`/api/audit?${query.toString()}`, { credentials: "same-origin" });
      const payload = await response.json() as { data?: AuditRow[]; error?: string };
      if (!response.ok) {
        setRows([]);
        setMessage(response.status === 401
          ? "需要有效登录会话。请通过已配置的身份认证流程登录后重试。"
          : response.status === 403
            ? "当前角色无权查看审计日志。此页面仅对 ADMIN 和 QA 开放。"
            : payload.error ?? "无法查询审计日志。");
        return;
      }
      const results = payload.data ?? [];
      setRows(results);
      setMessage(results.length ? `共显示 ${results.length} 条记录。` : "没有符合条件的审计记录。");
    } catch {
      setRows([]);
      setMessage("审计服务暂时不可用，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8">
      <form onSubmit={search} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">
          项目 ID
          <input className="rounded-md border border-slate-300 px-3 py-2 font-normal" value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="UUID" />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          操作人 ID
          <input className="rounded-md border border-slate-300 px-3 py-2 font-normal" value={actorId} onChange={(event) => setActorId(event.target.value)} placeholder="UUID" />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          操作类型
          <input className="rounded-md border border-slate-300 px-3 py-2 font-normal" value={action} onChange={(event) => setAction(event.target.value)} placeholder="例如 TASK_STATUS_CHANGED" />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          开始时间
          <input type="datetime-local" className="rounded-md border border-slate-300 px-3 py-2 font-normal" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          结束时间
          <input type="datetime-local" className="rounded-md border border-slate-300 px-3 py-2 font-normal" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <div className="flex items-end">
          <div className="flex gap-2">
          <button type="submit" disabled={loading || summaryLoading} className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
            {loading ? "查询中…" : "查询日志"}
          </button>
          <button type="button" onClick={scan} disabled={loading || summaryLoading} className="rounded-md border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-60">
            {summaryLoading ? "扫描中…" : "生成合规摘要"}
          </button>
          </div>
        </div>
      </form>

      {summary && <section className="my-6 rounded-xl border border-teal-200 bg-teal-50 p-5" aria-label="合规审计摘要">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">合规审计摘要</h2><span className="text-xs text-slate-600">摘要审计 ID：{summary.summaryId}{summary.degraded ? " · 规则降级" : ""}</span></div>
        <p className="mt-3 text-sm">{summary.summary.overview}</p>
        {summaryItems.map((item, index) => <article key={`${item.heading}-${index}`} className="mt-3 rounded-lg bg-white p-3 text-sm">
          <strong>{item.heading}</strong><p className="mt-1">{item.summary}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">{item.auditIds.map((id) => <a key={id} className="font-medium text-teal-800 underline" href={`#audit-${id}`}>审计记录 {id}</a>)}{item.recordIds.map((id) => <span key={id} className="text-slate-600">业务记录 {id}</span>)}</div>
        </article>)}
      </section>}
      <p role="status" aria-live="polite" className="my-4 text-sm text-slate-600">{message}</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3">操作人</th>
              <th className="px-4 py-3">操作</th>
              <th className="px-4 py-3">实体</th>
              <th className="px-4 py-3">项目 ID</th>
              <th className="px-4 py-3">变更</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} id={`audit-${row.id}`}>
                <td className="whitespace-nowrap px-4 py-3">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3">{row.actor?.name ?? "—"}{row.actor && <span className="block text-xs text-slate-500">{row.actor.role} · {row.actor.id}</span>}</td>
                <td className="whitespace-nowrap px-4 py-3">{row.action}</td>
                <td className="px-4 py-3">{row.entityType}<span className="block text-xs text-slate-500">{row.entityId}</span></td>
                <td className="px-4 py-3">{row.projectId ?? "全局"}</td>
                <td className="max-w-md px-4 py-3"><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify({ before: row.before, after: row.after }, null, 2)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
