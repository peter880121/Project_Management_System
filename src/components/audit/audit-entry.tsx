import Link from "next/link";
import {
  actionLabel,
  auditCategory,
  auditChanges,
  auditTime,
  entityLabels,
  statusLabels,
  type AuditDisplayRow,
} from "@/modules/audit/presentation";

export function AuditEntry({
  row,
  compact = false,
  evidence = false,
}: {
  row: AuditDisplayRow;
  compact?: boolean;
  evidence?: boolean;
}) {
  const changes = auditChanges(row);
  return (
    <article
      className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4"
      aria-label={actionLabel(row.action)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">
            {row.actor?.name ?? "未记录操作人"} · {actionLabel(row.action)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            <time>{auditTime(row.createdAt)}</time>
            {row.actorRole
              ? ` · ${statusLabels[row.actorRole] ?? row.actorRole}（操作时）`
              : " · 历史角色未记录"}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {auditCategory(row.action)}
        </span>
      </div>
      {row.entityType && (
        <p className="text-sm text-slate-600">
          {row.projectName
            ? `${row.projectName} / `
            : row.projectId
              ? "项目名称未记录 / "
              : "全局 / "}
          {entityLabels[row.entityType] ?? "业务记录"} ·{" "}
          {row.entityHref ? (
            <Link className="text-teal-800 underline" href={row.entityHref}>
              {row.entityName ?? "查看业务对象"}
            </Link>
          ) : (
            (row.entityName ?? "名称未记录")
          )}
          {row.entityName && (
            <span className="ml-1 text-xs text-slate-400">（当前名称）</span>
          )}
        </p>
      )}
      {changes.length ? (
        <dl className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
          {changes.slice(0, compact ? 2 : 4).map((c) => (
            <div
              key={c.key}
              className="grid min-w-0 gap-1 sm:grid-cols-[8rem_1fr]"
            >
              <dt className="text-slate-500">{c.label}</dt>
              <dd className="min-w-0 break-words">
                <span className="text-slate-500">{c.before}</span>
                <span aria-label="变更为" className="mx-2 text-slate-400">
                  →
                </span>
                <span className="text-slate-900">{c.after}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-slate-500">
          本次操作未记录字段变更，详细依据请查看原始证据。
        </p>
      )}
      {changes.length > (compact ? 2 : 4) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-teal-800">
            其余 {changes.length - (compact ? 2 : 4)} 项变更
          </summary>
          <dl className="mt-2 space-y-2">
            {changes.slice(compact ? 2 : 4).map((c) => (
              <div key={c.key} className="break-words">
                <dt className="text-slate-500">{c.label}</dt>
                <dd>
                  {c.before} → {c.after}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {evidence && (
        <Link
          className="inline-block text-sm text-teal-800 underline"
          href={`/audit/records/${row.id}`}
        >
          查看审计证据
        </Link>
      )}
      {!compact && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">原始证据与技术信息</summary>
          <p className="mt-2 break-all">
            审计 ID：{row.id} · 事件：{row.action} · 对象 ID：
            {row.entityId ?? "未记录"}
          </p>
          <p className="break-all">
            操作人 ID：{row.actor?.id ?? "未记录"} · 项目 ID：
            {row.projectId ?? "全局"} · IP：{row.ip ?? "未记录"} · User-Agent：
            {row.userAgent ?? "未记录"}
          </p>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-3">
            {JSON.stringify({ before: row.before, after: row.after }, null, 2)}
          </pre>
        </details>
      )}
    </article>
  );
}
