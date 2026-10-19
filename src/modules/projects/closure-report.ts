import { prisma } from "@/lib/prisma";
import { lockProject, lockUsers } from "@/modules/auth/transaction-locks";
import { assertProjectAccessTx, ProjectAccessError } from "@/modules/auth/project-access";
import { recordAudit, type AuditRequestMetadata } from "@/modules/audit/service";
import { snapshotHash } from "./acceptance";
import { ProjectError } from "./services";
export function escapeHtml(value: unknown) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
export function closureHtml(report: { project: { name: string; id: string }; snapshotSha256: string; evidence: unknown; [key: string]: unknown }) {
  const data = escapeHtml(JSON.stringify(report, null, 2));
  const evidence = report.evidence as { tasks?: { id: string; title: string; status: string; actualHours: string | null }[]; deliverables?: { id: string; version: number; sha256: string; status: string }[]; signatureAuditIds?: string[] };
  const tasks = (evidence.tasks ?? []).map(t => `<tr><td>${escapeHtml(t.title)}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.actualHours ?? "未记录")}</td></tr>`).join("");
  const files = (evidence.deliverables ?? []).map(d => `<tr><td>${escapeHtml(d.id)}</td><td>V${escapeHtml(d.version)} · ${escapeHtml(d.status)}</td><td class="hash">${escapeHtml(d.sha256)}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>结项报告 · ${escapeHtml(report.project.name)}</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#0f172a;background:#f1f5f9;margin:0;padding:40px}main{max-width:1000px;margin:auto;background:white;padding:36px;border:1px solid #cbd5e1;border-radius:16px}h1{color:#115e59}h2{margin-top:28px;font-size:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;background:#f8fafc;border-radius:8px;font:12px/1.8 ui-monospace,monospace}.badge{color:#065f46;background:#ecfdf5;padding:6px 12px;border-radius:6px}.hash{font:12px/1.8 ui-monospace,monospace;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed}th,td{border-bottom:1px solid #e2e8f0;padding:12px;text-align:left;overflow-wrap:anywhere}th{background:#f8fafc;color:#475569}@media print{body{background:white;padding:0}main{border:0}}</style><main><span class="badge">已归档 · 只读报告</span><h1>${escapeHtml(report.project.name)} · 结项报告</h1><p>本报告基于固定验收快照。工时、交付版本与签名引用均为归档时证据。</p><p class="hash">验收快照 SHA-256：${escapeHtml(report.snapshotSha256)}</p><h2>审批与归档</h2><p>QA 审查时间：${escapeHtml(report.qaApprovedAt)}<br>ADMIN 归档时间：${escapeHtml((report.project as { archivedAt?: string }).archivedAt)}</p><h2>最终任务与实际工时</h2><table><thead><tr><th>任务</th><th>最终状态</th><th>实际工时（小时）</th></tr></thead><tbody>${tasks}</tbody></table><h2>交付物版本清单</h2>${files ? `<table><thead><tr><th>交付物 ID</th><th>版本与审批</th><th>文件 SHA-256</th></tr></thead><tbody>${files}</tbody></table>` : "<p>无关联交付物。</p>"}<h2>电子签名审计引用</h2><p class="hash">${(evidence.signatureAuditIds ?? []).map(escapeHtml).join("<br>") || "无历史签名记录"}</p><details><summary>完整 JSON 证据与审批记录</summary><pre>${data}</pre></details></main></html>`;
}
export async function exportClosureReport(projectId: string, format: "json" | "html", actor: { actorId: string } & AuditRequestMetadata) {
  return prisma.$transaction(async tx => {
    await lockProject(tx, projectId); await lockUsers(tx, [actor.actorId]); await assertProjectAccessTx(tx, actor.actorId, projectId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.actorId }, select: { role: true } }); if (!["PM", "QA", "ADMIN"].includes(user.role)) throw new ProjectAccessError("仅 PM、QA、ADMIN 可导出结项报告");
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: { currentAcceptance: true } }); const acceptance = project.currentAcceptance;
    if (project.status !== "ARCHIVED" || !acceptance || acceptance.projectId !== projectId || acceptance.state !== "ARCHIVED") throw new ProjectError("归档后才能导出结项报告", 409);
    if (snapshotHash(acceptance.snapshot) !== acceptance.snapshotSha256) throw new ProjectError("验收快照完整性校验失败，禁止导出", 409);
    const report = { version: 1, project: { id: project.id, name: project.name, status: project.status, archivedAt: project.archivedAt?.toISOString(), archivedById: project.archivedById }, acceptanceId: acceptance.id, round: acceptance.round, snapshotSha256: acceptance.snapshotSha256, submittedById: acceptance.submittedById, submittedAt: acceptance.submittedAt.toISOString(), qaApprovedById: acceptance.qaApprovedById, qaApprovedAt: acceptance.qaApprovedAt?.toISOString(), evidence: acceptance.snapshot };
    await recordAudit(tx, { ...actor, projectId, action: "DATA_EXPORTED", entityType: "ProjectAcceptance", entityId: acceptance.id, after: { scope: { projectId, acceptanceId: acceptance.id }, format, snapshotSha256: acceptance.snapshotSha256 } });
    return format === "html" ? closureHtml(report) : JSON.stringify(report, null, 2);
  });
}
