"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import {
  CompliancePanel,
  SummaryHistory,
  type SavedSummary,
} from "./compliance-panel";

import { AuditEntry } from "@/components/audit/audit-entry";
import {
  actionLabels,
  auditCategories,
  type AuditDisplayRow,
} from "@/modules/audit/presentation";
type AuditRow = AuditDisplayRow;

type SummaryResult = SavedSummary & { auditLogs: AuditRow[] };

function asIsoDate(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

export default function AuditLogViewer({
  canReview = false,
  projects = [],
}: {
  canReview?: boolean;
  projects?: { id: string; name: string }[];
}) {
  const [projectId, setProjectId] = useState("");
  const [actorName, setActorName] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [message, setMessage] = useState(
    "填写筛选条件后查询，支持分页查阅全部匹配记录。",
  );
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [view, setView] = useState<"records" | "compliance">("records");

  const [category, setCategory] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const activeQuery = useRef("");
  const queryVersion = useRef(0);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const savedProject = q.get("projectId") ?? "";
    if (projects.some((p) => p.id === savedProject)) setProjectId(savedProject);
    setActorName(q.get("actorName") ?? "");
    setAction(q.get("action") ?? "");
    const savedCategory = q.get("category");
    if (auditCategories.some((c) => c === savedCategory))
      setCategory(savedCategory!);
    // ISO query times are restored as browser-local datetime inputs.
    const local = (value: string | null) => {
      if (!value || Number.isNaN(Date.parse(value))) return "";
      const d = new Date(value);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    };
    setFrom(local(q.get("from")));
    setTo(local(q.get("to")));
  }, [projects]);

  async function scan() {
    if (!projectId.trim()) {
      setMessage("请先选择要生成合规摘要的项目。");
      return;
    }
    setView("compliance");
    setSummaryLoading(true);
    setNextCursor(null);
    const version = ++queryVersion.current;
    setSummary(null);
    const fromIso = asIsoDate(from);
    const toIso = asIsoDate(to);
    try {
      const response = await fetch("/api/audit/summary", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: projectId.trim(),
          ...(fromIso ? { from: fromIso } : {}),
          ...(toIso ? { to: toIso } : {}),
        }),
      });
      const payload = (await response.json()) as SummaryResult & {
        error?: string;
      };
      if (version !== queryVersion.current) return;
      if (!response.ok) {
        setMessage(payload.error ?? "无法生成合规摘要。");
        return;
      }
      setSummary(payload);
      // Scan provenance is retained in the summary. Operation records keep their own query and pagination.
      setMessage(
        payload.degraded
          ? "语言模型不可用，已返回规则扫描结果和原始审计记录。"
          : "合规摘要已生成并写入审计日志。",
      );
    } catch {
      setMessage("审计服务暂时不可用，请稍后重试。");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function search(event?: FormEvent<HTMLFormElement>, cursor?: string) {
    event?.preventDefault();
    setView("records");
    const version = ++queryVersion.current;
    setLoading(true);
    setMessage("");
    const query = cursor
      ? new URLSearchParams(activeQuery.current)
      : new URLSearchParams();
    if (!cursor && projectId.trim()) query.set("projectId", projectId.trim());
    if (!cursor && actorName.trim()) query.set("actorName", actorName.trim());
    if (!cursor && category) query.set("category", category);
    if (!cursor && action.trim()) query.set("action", action.trim());
    const fromIso = asIsoDate(from);
    const toIso = asIsoDate(to);
    if (!cursor && fromIso) query.set("from", fromIso);
    if (!cursor && toIso) query.set("to", toIso);

    if (cursor) query.set("cursor", cursor);
    else {
      activeQuery.current = query.toString();
      window.history.replaceState(null, "", `/audit?${query}`);
      setNextCursor(null);
    }
    try {
      const response = await fetch(`/api/audit?${query.toString()}`, {
        credentials: "same-origin",
      });
      const payload = (await response.json()) as {
        data?: AuditRow[];
        error?: string;
        nextCursor?: string | null;
      };
      if (version !== queryVersion.current) return;
      if (!response.ok) {
        setRows([]);
        setMessage(
          response.status === 401
            ? "需要有效登录会话。请通过已配置的身份认证流程登录后重试。"
            : response.status === 403
              ? "当前角色无权查看审计日志。此页面仅对 ADMIN 和 QA 开放。"
              : (payload.error ?? "无法查询审计日志。"),
        );
        return;
      }
      const results = payload.data ?? [];
      setRows((old) => (cursor ? [...old, ...results] : results));
      setNextCursor(payload.nextCursor ?? null);
      setMessage(
        results.length
          ? `共显示 ${results.length} 条记录。`
          : "没有符合条件的审计记录。",
      );
    } catch {
      setRows([]);
      setMessage("审计服务暂时不可用，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="mb-4 flex gap-2" role="tablist" aria-label="审计工作区">
        <button
          type="button"
          role="tab"
          aria-selected={view === "records"}
          aria-controls="audit-records"
          id="records-tab"
          onClick={() => setView("records")}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm"
        >
          操作记录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "compliance"}
          aria-controls="audit-compliance"
          id="compliance-tab"
          onClick={() => setView("compliance")}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm"
        >
          合规检查
        </button>
      </div>
      <form
        onSubmit={(event) => void search(event)}
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2 lg:grid-cols-3"
      >
        <label className="grid gap-1 text-sm font-medium">
          项目
          <select
            aria-label="选择审计项目"
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
            value={projectId}
            onChange={(event) => {
              queryVersion.current++;
              setProjectId(event.target.value);
              setSummary(null);
              setRows([]);
              setNextCursor(null);
            }}
          >
            <option value="">全部可访问项目（生成摘要需选定一个项目）</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          操作人姓名
          <input
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
            value={actorName}
            onChange={(event) => setActorName(event.target.value)}
            placeholder="输入操作人姓名"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          操作类型
          <select
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            <option value="">全部操作</option>
            {Object.entries(actionLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          开始时间
          <input
            type="datetime-local"
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          结束时间
          <input
            type="datetime-local"
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <div className="flex items-end">
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || summaryLoading}
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {loading ? "查询中…" : "查询日志"}
            </button>
            <button
              type="button"
              onClick={scan}
              disabled={loading || summaryLoading}
              className="rounded-md border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-60"
            >
              {summaryLoading ? "扫描中…" : "生成合规摘要"}
            </button>
          </div>
        </div>
      </form>

      <p className="mt-3 text-xs text-slate-500">
        合规检查扫描所选项目的当前业务快照；操作人、分类和操作类型筛选仅用于操作记录。时间筛选使用浏览器本地时区，记录显示为
        UTC+8。
      </p>
      <div
        role="tabpanel"
        id="audit-compliance"
        aria-labelledby="compliance-tab"
        hidden={view !== "compliance"}
      >
        <SummaryHistory
          key={projectId}
          projectId={projectId}
          canReview={canReview}
        />
        {summary && (
          <CompliancePanel
            key={summary.summaryId}
            initial={summary}
            canReview={canReview}
          />
        )}
      </div>
      <p
        role="status"
        aria-live="polite"
        className="my-4 text-sm text-slate-600"
      >
        {message}
      </p>
      <div
        role="tabpanel"
        id="audit-records"
        aria-labelledby="records-tab"
        hidden={view !== "records"}
      >
        <div className="mb-4 flex flex-wrap gap-2" aria-label="审计分类">
          {["", ...auditCategories].map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`rounded-full border border-slate-200 px-3 py-1 text-sm ${category === c ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-200"}`}
            >
              {c || "全部类别"}
            </button>
          ))}
          <span className="self-center text-xs text-slate-500">
            选择后点击查询日志
          </span>
        </div>
        <div className="space-y-3" aria-label="操作记录">
          {rows.map((row) => (
            <AuditEntry key={row.id} row={row} evidence />
          ))}
        </div>
        {nextCursor && (
          <button
            className="mt-4 rounded border border-slate-200 px-4 py-2 text-sm"
            disabled={loading}
            onClick={() => void search(undefined, nextCursor)}
          >
            加载更多记录
          </button>
        )}
      </div>
    </section>
  );
}
