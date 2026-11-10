import { auditTime, statusLabels, findingLabels } from "./presentation";
import { issueActionLabels } from "./issue-schema";
import type { auditReport } from "./issue-service";
export const escapeHtml = (value: unknown) =>
  String(value ?? "未记录").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderAuditReport(
  report: Awaited<ReturnType<typeof auditReport>>,
) {
  const e = escapeHtml;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>审计整改报告</title><style>body{font:15px/1.7 system-ui;max-width:1000px;margin:40px auto;padding:20px;color:#163047}article{border:1px solid #dbe3e9;padding:20px;margin:20px 0;border-radius:12px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#526577}@media print{article{break-inside:avoid}}</style><h1>审计整改报告 · ${e(report.projectName)}</h1><p>导出时间：${e(auditTime(report.exportedAt))} · 导出人 ID：${e(report.actorId)}</p><p>范围：项目全部 ${report.issues.length} 项整改问题及其发现、处理和验证记录。名称为当前名称；历史证据以快照为准。</p><p>摘要采纳与问题关闭均不代表项目发布批准。</p>${report.issues.map((i) => `<article><h2>${e(findingLabels[i.code] ?? i.title)}</h2><p>问题编号：${e(i.id)}</p><p>状态：${e(statusLabels[i.status] ?? i.status)} · 风险：${e(statusLabels[i.severity])} · 负责人：${e(i.assignedTo?.name ?? "未分派")} · 截止：${i.dueDate ? e(auditTime(i.dueDate)) : "未设置"}</p><p>${e(i.title)}</p><h3>处理过程</h3><table><tr><th>时间</th><th>操作人</th><th>操作与状态</th><th>说明</th></tr>${i.events.map((v) => `<tr><td>${e(auditTime(v.createdAt))}</td><td>${e(v.actor.name)}</td><td>${e(issueActionLabels[v.action])} · ${e(statusLabels[v.toStatus])}</td><td>${e(v.note)}</td></tr>`).join("")}</table><details><summary>发现与整改原始证据（含文档校验值、规则验证和来源 ID）</summary><pre>${e(JSON.stringify({ occurrences: i.occurrences, events: i.events }, null, 2))}</pre></details></article>`).join("")}<p>证据数据 SHA-256：${e(report.sha256)}</p></html>`;
}
