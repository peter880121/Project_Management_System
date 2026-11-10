"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  auditTime,
  findingLabels,
  statusLabels,
} from "@/modules/audit/presentation";
import { issueStates } from "@/modules/audit/issue-schema";
import { Button } from "@/components/ui/button";
type Row = {
  id: string;
  projectId: string;
  title: string;
  code: string;
  status: string;
  severity: string;
  dueDate: string | null;
  project: { name: string };
  assignedTo: { name: string } | null;
};
export function IssuesWorkspace({
  projects,
  canExport,
  initialProjectId = "",
  initialStatus = "",
  initialOverdue = false,
}: {
  projects: { id: string; name: string }[];
  canExport: boolean;
  initialProjectId?: string;
  initialStatus?: string;
  initialOverdue?: boolean;
}) {
  const [projectId, setProjectId] = useState(initialProjectId),
    [status, setStatus] = useState(initialStatus);
  const [overdueOnly, setOverdueOnly] = useState(initialOverdue);
  const [rows, setRows] = useState<Row[]>([]),
    [counts, setCounts] = useState<Record<string, number>>({});
  const [overdue, setOverdue] = useState(0),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState("");
  const version = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++version.current;
    setLoading(true);
    setRows([]);
    setCursor(null);
    setMessage("");
    const query = new URLSearchParams({
      ...(projectId ? { projectId } : {}),
      ...(status ? { status } : {}),
      ...(overdueOnly ? { overdue: "true" } : {}),
    });
    window.history.replaceState(null, "", `/audit/issues?${query}`);
    fetch(`/api/audit/issues?${query}`, { signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error);
        if (current !== version.current) return;
        setRows(payload.data);
        setCounts(payload.counts);
        setOverdue(payload.overdue);
        setCursor(payload.nextCursor);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setMessage(error instanceof Error ? error.message : "查询失败");
      })
      .finally(() => {
        if (current === version.current) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, status, overdueOnly]);
  async function more() {
    const current = version.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        ...(projectId ? { projectId } : {}),
        ...(status ? { status } : {}),
        ...(overdueOnly ? { overdue: "true" } : {}),
        cursor: cursor!,
      });
      const res = await fetch(`/api/audit/issues?${q}`);
      const p = await res.json();
      if (!res.ok) throw new Error(p.error);
      if (current !== version.current) return;
      setRows((old) => [...old, ...p.data]);
      setCursor(p.nextCursor);
    } catch (e) {
      if (current === version.current)
        setMessage(e instanceof Error ? e.message : "查询失败");
    } finally {
      if (current === version.current) setLoading(false);
    }
  }
  async function download() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/audit/issues/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "audit-remediation.html";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("整改报告已导出并记录审计。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "导出失败");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="mt-6 space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        {["PENDING", "REMEDIATING", "VERIFYING"].map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(s);
              setOverdueOnly(false);
            }}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left"
          >
            <span className="text-sm text-slate-500">{statusLabels[s]}</span>
            <strong className="mt-2 block text-2xl">{counts[s] ?? 0}</strong>
          </button>
        ))}
        <button
          onClick={() => {
            setStatus("");
            setOverdueOnly(!overdueOnly);
          }}
          aria-pressed={overdueOnly}
          className="rounded-xl border border-slate-200 bg-amber-50 p-4 text-left"
        >
          <span className="text-sm">逾期未关闭</span>
          <strong className="mt-2 block text-2xl">{overdue}</strong>
        </button>
      </div>
      {overdueOnly && (
        <p className="text-sm text-amber-800">
          仅显示逾期未关闭问题。再次点击逾期卡片可取消筛选。
        </p>
      )}
      {canExport && (
        <p className="text-xs text-slate-500">
          报告导出所选项目的全部问题及证据，不受状态筛选限制。
        </p>
      )}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="grid gap-1 text-sm">
          项目
          <select
            aria-label="整改项目"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded border border-slate-200 p-2"
          >
            <option value="">全部可访问项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          处理状态
          <select
            aria-label="整改状态"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border border-slate-200 p-2"
          >
            <option value="">全部状态</option>
            {issueStates.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
        </label>
        {canExport && (
          <Button
            disabled={!projectId || loading}
            onClick={() => void download()}
          >
            导出整改报告
          </Button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {loading && <p role="status">正在加载…</p>}
      {!loading && !rows.length && !message && (
        <p className="rounded-xl border border-dashed p-8 text-center text-slate-500">
          当前范围内没有整改问题。QA 可从合规检查生成审计发现。
        </p>
      )}
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/audit/issues/${row.id}`}
          className="block space-y-2 rounded-xl border border-slate-200 bg-white p-5 hover:border-teal-600"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="font-semibold">
              {findingLabels[row.code] ?? row.title}
            </h2>
            <span
              className={`rounded-full px-3 py-1 text-xs ${row.status === "CLOSED" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
            >
              {statusLabels[row.status]}
            </span>
          </div>
          <p className="text-sm text-slate-600">
            {row.project.name} · 风险：{statusLabels[row.severity]} · 负责人：
            {row.assignedTo?.name ?? "待分派"}
          </p>
          <p className="text-sm text-slate-500">{row.title}</p>
          <p className="text-xs text-slate-500">
            截止时间：{row.dueDate ? auditTime(row.dueDate) : "待设置"} · 编号{" "}
            {row.id.slice(0, 8)}
          </p>
        </Link>
      ))}
      {cursor && (
        <Button disabled={loading} onClick={() => void more()}>
          加载更多问题
        </Button>
      )}
    </div>
  );
}
