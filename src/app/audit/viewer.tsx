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
  actor: { id: string; name: string; role: string };
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
          <button type="submit" disabled={loading} className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
            {loading ? "查询中…" : "查询日志"}
          </button>
        </div>
      </form>

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
              <tr key={row.id}>
                <td className="whitespace-nowrap px-4 py-3">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3">{row.actor.name}<span className="block text-xs text-slate-500">{row.actor.role} · {row.actor.id}</span></td>
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
