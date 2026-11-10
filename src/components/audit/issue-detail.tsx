"use client";
import Link from "next/link";
import { SourceAuditLinks } from "./source-audit-links";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  auditTime,
  findingLabels,
  statusLabels,
} from "@/modules/audit/presentation";
import {
  issueActionLabels,
  type IssueCommand,
} from "@/modules/audit/issue-schema";
import { Button } from "@/components/ui/button";
type Evidence = {
  documents?: { id: string; filename: string; sha256: string | null }[];
  verification?: {
    result: string;
    verifiedAt: string;
    ruleVersion: string;
  } | null;
  assignedToId?: string;
  assignedToName?: string;
  dueDate?: string;
};
type Detail = {
  id: string;
  projectId: string;
  title: string;
  code: string;
  status: string;
  severity: string;
  rowVersion: number;
  assignedToId: string | null;
  assignedTo: { name: string } | null;
  dueDate: string | null;
  project: { name: string };
  occurrences: {
    id: string;
    summaryId: string;
    createdAt: string;
    evidence: {
      summary: string;
      recordIds: string[];
      auditIds: string[];
      sourceAuditMissing: boolean;
      requirementVersion: number | null;
    };
  }[];
  events: {
    id: string;
    actorId: string;
    action: string;
    toStatus: string;
    note: string;
    createdAt: string;
    actor: { name: string };
    evidence: Evidence;
  }[];
};
type Option = { id: string; name: string };
export function IssueDetail({
  id,
  role,
  userId,
}: {
  id: string;
  role: string;
  userId: string;
}) {
  const [data, setData] = useState<Detail | null>(null),
    [members, setMembers] = useState<Option[]>([]),
    [documents, setDocuments] = useState<{ id: string; filename: string }[]>(
      [],
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [action, setAction] = useState<IssueCommand["action"] | "">("");
  const load = useCallback(async () => {
    const res = await fetch(`/api/audit/issues/${id}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error);
    setData(payload.data);
    setMembers(payload.members);
    setDocuments(payload.documents);
  }, [id]);
  useEffect(() => {
    load().catch((e) =>
      setMessage(e instanceof Error ? e.message : "读取失败"),
    );
  }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const body = {
        action,
        expectedRowVersion: data.rowVersion,
        note: form.get("note"),
        evidenceIds: form.getAll("evidenceIds"),
        ...(action === "ASSIGN"
          ? {
              assignedToId: form.get("assignedToId"),
              dueDate: new Date(String(form.get("dueDate"))).toISOString(),
            }
          : {}),
        ...(action === "CONFIRM" ? { severity: form.get("severity") } : {}),
      };
      const res = await fetch(`/api/audit/issues/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error);
      await load();
      setAction("");
      setMessage("处理已保存，操作与证据已记录审计。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p role="status">{message || "正在读取问题…"}</p>;
  const options: IssueCommand["action"][] = [];
  if (role === "QA") {
    if (data.status === "PENDING") options.push("CONFIRM", "DISMISS");
    if (data.status === "VERIFYING") options.push("CLOSE", "RETURN");
    if (["CLOSED", "DISMISSED"].includes(data.status)) options.push("REOPEN");
  }
  if (
    ["QA", "PM"].includes(role) &&
    ["OPEN", "REMEDIATING"].includes(data.status)
  )
    options.push("ASSIGN");
  if (data.assignedToId === userId && data.status === "REMEDIATING")
    options.push("SUBMIT");
  const lastDecision = [...data.events]
    .reverse()
    .find((e) => ["CLOSE", "DISMISS"].includes(e.action));
  const recurring =
    ["CLOSED", "DISMISSED"].includes(data.status) &&
    lastDecision &&
    data.occurrences.some(
      (o) => new Date(o.createdAt) > new Date(lastDecision.createdAt),
    );
  return (
    <>
      <header className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-500">
          {data.project.name} · 问题编号 {data.id.slice(0, 8)}
        </p>
        <h1 className="text-2xl font-semibold">
          {findingLabels[data.code] ?? data.title}
        </h1>
        <p>{data.title}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <strong className="text-teal-800">{statusLabels[data.status]}</strong>
          <span>风险：{statusLabels[data.severity]}</span>
          <span>负责人：{data.assignedTo?.name ?? "待分派"}</span>
          <span>截止：{data.dueDate ? auditTime(data.dueDate) : "未设置"}</span>
        </div>
        <p className="text-xs text-slate-500">
          发现 → 复核 → 分派 → 整改 → 验证 → 关闭。每次处理均保留历史记录。
        </p>
        {recurring && (
          <p
            role="alert"
            className="rounded bg-amber-50 p-3 text-sm text-amber-900"
          >
            处理决定后再次检测到此问题，请 QA 复查并决定是否重新打开。
          </p>
        )}
      </header>
      {options.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">处理此问题</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {options.map((a) => (
              <Button
                key={a}
                disabled={busy}
                variant="outline"
                onClick={() => setAction(a)}
              >
                {issueActionLabels[a]}
              </Button>
            ))}
          </div>
          {action && (
            <form onSubmit={submit} className="mt-4 space-y-4">
              <p className="text-sm font-medium">{issueActionLabels[action]}</p>
              {action === "CONFIRM" && (
                <label className="block text-sm">
                  风险等级
                  <select
                    aria-label="风险等级"
                    name="severity"
                    defaultValue={data.severity}
                    className="ml-3 rounded border border-slate-200 p-2"
                  >
                    <option value="HIGH">高</option>
                    <option value="MEDIUM">中</option>
                    <option value="LOW">低</option>
                  </select>
                </label>
              )}
              {action === "ASSIGN" && (
                <div className="flex flex-wrap gap-4">
                  <label className="grid gap-1 text-sm">
                    整改负责人
                    <select
                      aria-label="整改负责人"
                      name="assignedToId"
                      required
                      defaultValue={data.assignedToId ?? ""}
                      className="rounded border border-slate-200 p-2"
                    >
                      <option value="">请选择项目成员</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    截止日期（本地时区）
                    <input
                      type="datetime-local"
                      name="dueDate"
                      required
                      className="rounded border border-slate-200 p-2"
                    />
                  </label>
                </div>
              )}
              {action === "SUBMIT" && (
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm">
                    整改证据（至少选择一项项目文档）
                  </legend>
                  {documents.length ? (
                    documents.map((d) => (
                      <label
                        key={d.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          name="evidenceIds"
                          value={d.id}
                        />
                        {d.filename}
                      </label>
                    ))
                  ) : (
                    <p className="text-sm text-amber-800">
                      暂无可用证据，请先到项目文档上传本人和 QA
                      均可访问的整改材料。
                    </p>
                  )}
                  <Link
                    className="block text-sm text-teal-800 underline"
                    href={`/projects/${data.projectId}/documents`}
                  >
                    打开项目文档
                  </Link>
                </fieldset>
              )}
              {action === "CLOSE" && (
                <p className="rounded bg-teal-50 p-3 text-sm">
                  验证提交后将重新运行当前项目规则检查，并核对整改证据校验值。请先人工核实下方材料。
                </p>
              )}
              <label className="grid gap-1 text-sm">
                处理说明
                <textarea
                  name="note"
                  aria-label="整改处理说明"
                  required
                  maxLength={2000}
                  className="min-h-24 rounded border border-slate-200 p-3"
                />
              </label>
              <Button disabled={busy}>{busy ? "保存中…" : "提交处理"}</Button>
            </form>
          )}
        </section>
      )}
      {message && (
        <p
          role="status"
          className="rounded border border-slate-200 p-3 text-sm"
        >
          {message}
        </p>
      )}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">整改与验证时间线</h2>
        {!data.events.length && (
          <p className="text-sm text-slate-500">等待 QA 复核发现。</p>
        )}
        {data.events.map((e) => (
          <article
            key={e.id}
            className="space-y-2 border-l-2 border-teal-600 pl-4"
          >
            <p className="text-sm font-medium">
              {e.actor.name} · {issueActionLabels[e.action]} →{" "}
              {statusLabels[e.toStatus]}
            </p>
            <p className="text-xs text-slate-500">{auditTime(e.createdAt)}</p>
            <p className="whitespace-pre-wrap text-sm">{e.note}</p>
            {e.evidence.assignedToName && (
              <p className="text-sm">
                分派给：{e.evidence.assignedToName}（分派时名称）
              </p>
            )}
            {e.evidence.dueDate && (
              <p className="text-sm">
                分派截止：{auditTime(e.evidence.dueDate)}
              </p>
            )}
            {e.evidence.documents?.map((d) => (
              <div key={d.id} className="break-all text-xs">
                <a
                  href={`/api/documents/${d.id}/download`}
                  className="text-teal-800 underline"
                >
                  {d.filename}
                </a>
                <p className="text-slate-500">
                  提交时 SHA-256：{d.sha256 ?? "未记录"}
                </p>
              </div>
            ))}
            {e.evidence.verification && (
              <p className="text-sm text-teal-800">
                规则复查通过 · 规则版本 {e.evidence.verification.ruleVersion} ·{" "}
                {auditTime(e.evidence.verification.verifiedAt)}
              </p>
            )}
          </article>
        ))}
      </section>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">发现与来源证据</h2>
        <p className="text-xs text-slate-500">
          展示最近 20
          次发现；导出报告包含全部发现。历史检查不会因后续整改而被改写。
        </p>
        {data.occurrences.map((o) => (
          <article
            className="space-y-2 rounded border border-slate-200 p-3"
            key={o.id}
          >
            <p className="text-sm">
              {auditTime(o.createdAt)} · {o.evidence.summary}
            </p>
            <p className="text-xs text-slate-500">
              需求版本：{o.evidence.requirementVersion ?? "无关联版本"} ·
              来源检查 {o.summaryId.slice(0, 8)}
            </p>
            {o.evidence.sourceAuditMissing && (
              <p className="text-xs text-amber-800">
                当次检查范围内缺少来源审计，需要补查。
              </p>
            )}
            {["ADMIN", "QA"].includes(role) && (
              <SourceAuditLinks ids={o.evidence.auditIds} />
            )}
            <Link
              className="block text-xs text-teal-800 underline"
              href={`/projects/${data.projectId}/traceability`}
            >
              打开需求、任务与测试追溯
            </Link>
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">完整来源标识</summary>
              <p className="break-all">
                检查 ID：{o.summaryId} · 业务记录：
                {o.evidence.recordIds.join("、")}
              </p>
            </details>
          </article>
        ))}
      </section>
    </>
  );
}
