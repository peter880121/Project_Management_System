"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import { businessToday } from "@/modules/tasks/plan";
import { workflowLabels, type RequirementOperation } from "@/modules/requirements/schemas";
import { Field, fieldClass, RequirementDialog, RequirementFields, jsonRequest, requirementFormData, selectedImages, uploadImages, type Detail, type Options } from "./forms";

const labels: Record<RequirementOperation, string> = { submit: "提交评审", approve: "签署并批准", return: "退回修改", start: "开始实施", verify: "提交验证", "record-test": "登记验证结果", "confirm-verification": "验证通过", "customer-confirm": "登记客户确认", "request-fix": "退回整改", close: "关闭需求", cancel: "取消需求", "approve-cancel": "批准取消", "return-cancel": "驳回取消", "withdraw-change": "撤回需求变更", change: "发起需求变更", "link-task": "关联实施任务", comment: "记录沟通" };
const panel = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
export function Images({ projectId, images }: { projectId: string; images: { id: string; filename: string; sha256: string }[] }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{images.map(image => <a key={image.id} href={`/api/projects/${projectId}/requirements/images/${image.id}`} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2" title={`${image.filename} · SHA256 ${image.sha256}`}>
    {/* Private, authenticated URLs must not be sent through a public image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/api/projects/${projectId}/requirements/images/${image.id}`} alt={image.filename} className="h-28 w-full rounded-lg object-contain" loading="lazy" /><span className="mt-2 block truncate text-xs text-slate-600">{image.filename}</span>
  </a>)}</div>;
}
export function RequirementDetail({ projectId, detail, options, role, userId, writable, onRefresh }: { projectId: string; detail: Detail; options: Options; role: string; userId: string; writable: boolean; onRefresh: () => Promise<void> }) {
  const { notify } = useToast(); const [mode, setMode] = useState<RequirementOperation | "edit" | "test-case" | null>(null); const [busy, setBusy] = useState(false); const [tab, setTab] = useState("content");
  const state = detail.workflowState; const manager = ["PM", "ADMIN"].includes(role); const reviewer = ["QA", "ADMIN"].includes(role); const version = detail.draftVersion ?? detail.approvedVersion ?? detail.version;
  const revision = detail.revisions.find(r => r.version === version); const approved = detail.revisions.find(r => r.version === detail.approvedVersion);
  const submission = detail.decisions.find(d => d.action === "SUBMIT" && d.revisionNumber === version);
  const actions: RequirementOperation[] = [];
  if (manager) {
    if (state === "DRAFT") actions.push("submit");
    if (detail.approvedVersion && ["DRAFT", "IN_REVIEW"].includes(state)) actions.push("withdraw-change");
    if (state === "APPROVED") actions.push("start");
    if (state === "IMPLEMENTING") actions.push("verify");
    if (state === "CUSTOMER_CONFIRMATION") actions.push("customer-confirm", "close");
    if (["VERIFYING", "CUSTOMER_CONFIRMATION"].includes(state)) actions.push("request-fix");
    if (["DRAFT", "APPROVED", "IMPLEMENTING"].includes(state)) actions.push("link-task");
    if (["APPROVED", "IMPLEMENTING", "VERIFYING", "CUSTOMER_CONFIRMATION", "CLOSED"].includes(state)) actions.push("change");
    if (!["CANCELLED", "CLOSED", "CANCEL_REVIEW"].includes(state)) actions.push("cancel");
  }
  if (reviewer && state === "IN_REVIEW" && submission?.actorId !== userId) actions.push("approve", "return");
  if (reviewer && state === "CANCEL_REVIEW") actions.push("approve-cancel", "return-cancel");
  if (reviewer && state === "VERIFYING") actions.push("record-test", "confirm-verification");
  if (["PM", "QA", "MEMBER", "ADMIN"].includes(role) && state !== "CANCELLED") actions.push("comment");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !writable || !mode) return; const form = new FormData(event.currentTarget); let committed = false;
    setBusy(true);
    try {
      if (mode === "edit") {
        const files = selectedImages(form); const updated = await jsonRequest<{ rowVersion: number }>(`/api/projects/${projectId}/requirements/${detail.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...requirementFormData(form), expectedRowVersion: detail.rowVersion }) }); committed = true;
        await uploadImages(projectId, "requirements", detail.id, updated.rowVersion, files);
      } else if (mode === "test-case") {
        await jsonRequest(`/api/projects/${projectId}/traceability`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "testCase", requirementId: detail.id, title: form.get("title"), status: "NOT_RUN" }) }); committed = true;
      } else {
        const body: Record<string, unknown> = { requestKey: crypto.randomUUID(), expectedRowVersion: detail.rowVersion, comment: String(form.get("comment") ?? "") };
        for (const name of ["signaturePassword", "completedAt", "documentId", "taskId", "testCaseId", "result"]) if (form.get(name)) body[name] = form.get(name);
        if (mode === "change") body.impact = Object.fromEntries(["schedule", "cost", "scope", "risk"].map(key => [key, String(form.get(key) ?? "")]));
        await jsonRequest(`/api/projects/${projectId}/requirements/${detail.id}/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); committed = true;
      }
      setMode(null); notify("需求操作已保存");
      try { await onRefresh(); } catch { notify("保存已成功，但数据刷新失败，请手动刷新", "error"); }
    } catch (error) { if (committed) { setMode(null); notify("需求已保存，部分图片未上传成功，请在草稿中补传", "error"); await onRefresh().catch(() => {}); } else notify(error instanceof Error ? error.message : "操作失败", "error"); }
    finally { setBusy(false); }
  }
  const tasks = [...new Map([...detail.tasks, ...detail.taskLinks.map(l => l.task)].map(t => [t.id, t])).values()];
  return <section className="space-y-5" aria-label="需求详情">
    <div className={panel}><div className="flex flex-wrap items-center gap-3"><span className="font-mono text-sm text-teal-800">{detail.number ?? "历史需求"}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${state === "CANCELLED" ? "bg-slate-200 text-slate-600" : state === "CLOSED" ? "bg-emerald-50 text-emerald-800" : "bg-teal-50 text-teal-800"}`}>{detail.managed ? workflowLabels[state as keyof typeof workflowLabels] : "历史记录"}</span><span className="text-xs text-slate-500">当前批准 {detail.approvedVersion ? `V${detail.approvedVersion}` : "尚未批准"}{detail.draftVersion ? ` · 草稿 V${detail.draftVersion}` : ""}</span></div><h2 className="mt-3 break-words text-2xl font-semibold">{revision?.title ?? detail.title}</h2><div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><p>预计完成：<strong>{(revision?.dueDate ?? detail.dueDate)?.slice(0, 10) ?? "未填写"}</strong></p><p>实际完成：<strong>{detail.draftVersion && detail.approvedVersion ? "新版本尚未完成" : detail.completedAt?.slice(0, 10) ?? "尚未完成"}</strong></p></div>
    {!detail.managed && <p className="mt-4 text-sm text-amber-800">历史需求保留原有追溯记录，可在追溯矩阵查看。本模块不会自动改变历史批准证据。</p>}
    {detail.managed && <div className="mt-4 flex flex-wrap gap-2">{manager && state === "DRAFT" && <Button disabled={!writable} variant="outline" onClick={() => setMode("edit")}>编辑需求与图片</Button>}{actions.map(action => <Button key={action} disabled={!writable} variant={action === "cancel" ? "destructive" : ["approve", "close", "submit"].includes(action) ? "default" : "outline"} onClick={() => setMode(action)}>{labels[action]}</Button>)}</div>}
    </div>
    <nav aria-label="需求详情视图" className="flex flex-wrap gap-2">{[["content", "需求内容"], ["tasks", "实施与验证"], ["history", "版本与审计"]].map(([key, title]) => <Button key={key} variant={tab === key ? "default" : "outline"} onClick={() => setTab(key)}>{title}</Button>)}</nav>
    {tab === "content" && <div className={panel}><h3 className="font-semibold">需求说明</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{revision?.content ?? detail.content}</p><h3 className="mt-6 font-semibold">验收标准</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{revision?.acceptanceCriteria ?? "历史记录未填写"}</p>{(detail.attachments.length > 0 || detail.intakes.some(i => i.attachments.length)) && <div className="mt-6"><h3 className="mb-3 font-semibold">需求图片 · 原始证据保留</h3><Images projectId={projectId} images={[...detail.attachments, ...detail.intakes.flatMap(i => i.attachments)]} /></div>}{detail.intakes.length > 0 && <div className="mt-5 rounded-xl bg-teal-50 p-4 text-sm">来源诉求：{detail.intakes.map(i => i.title).join("、")}</div>}</div>}
    {tab === "tasks" && <div className="grid gap-5 lg:grid-cols-2"><div className={panel}><div className="flex items-center justify-between"><h3 className="font-semibold">关联实施任务</h3>{manager && writable && ["DRAFT", "APPROVED", "IMPLEMENTING"].includes(state) && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/projects/${projectId}/tasks/new?requirementId=${detail.id}`}>创建任务</Link>}</div><ul className="mt-4 space-y-3">{tasks.map(t => <li key={t.id} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 text-sm"><Link href={`/projects/${projectId}/board?taskId=${t.id}`} className="text-teal-800 hover:underline">{t.title}</Link><span className="text-xs text-slate-500">{t.status}</span></li>)}</ul>{!tasks.length && <p className="mt-5 text-sm text-slate-500">还没有实施任务，请由 PM 创建或关联。</p>}</div><div className={panel}><div className="flex items-center justify-between"><h3 className="font-semibold">测试与验证证据</h3>{role === "QA" && <Button size="sm" variant="outline" disabled={!writable || ["CLOSED", "CANCELLED"].includes(state)} onClick={() => setMode("test-case")}>新增测试用例</Button>}</div>{detail.testCases.map(test => { const result = detail.executions.find(e => e.testCaseId === test.id && detail.revisions.find(r => r.id === e.revisionId)?.version === detail.approvedVersion); return <div key={test.id} className="mt-4 border-b border-slate-100 pb-3 text-sm"><p>{test.title}</p><p className="mt-2 text-xs text-slate-500">当前版本验证：{result?.result ?? "未执行"}</p>{result && <Link href={`/api/documents/${result.documentId}/download`} className="mt-2 inline-block text-teal-800 underline">查看验证证据</Link>}</div>; })}{!detail.testCases.length && <p className="mt-5 text-sm text-slate-500">请由 QA 建立可验证的测试用例。</p>}</div></div>}
    {tab === "history" && <div className="space-y-5"><div className={panel}><h3 className="font-semibold">版本对比</h3>{revision && <div className="mt-4 grid gap-4 lg:grid-cols-2">{[{ label: "当前批准版本", row: approved }, { label: detail.draftVersion ? "待评审草稿" : "当前版本", row: revision }].map(({ label, row }) => <div key={label} className="min-w-0 rounded-xl bg-slate-50 p-4"><h4 className="text-sm font-semibold">{label}{row ? ` · V${row.version}` : " · 暂无"}</h4>{row && <><p className="mt-3 text-sm">预计完成：{row.dueDate.slice(0, 10)}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{row.content}</p><p className="mt-3 whitespace-pre-wrap text-sm">验收标准：{row.acceptanceCriteria}</p><p className="mt-3 break-all font-mono text-[10px] text-slate-400">SHA256 {row.sha256}</p></>}</div>)}</div>}<details className="mt-4"><summary className="cursor-pointer text-sm text-teal-800">查看最近历史版本（{detail.revisions.length}）</summary>{detail.revisions.map(r => <div key={r.id} className="mt-3 rounded-xl border border-slate-100 p-3 text-sm"><strong>V{r.version} · {r.title}</strong><p className="mt-2">预计完成：{r.dueDate.slice(0, 10)}</p><p className="mt-2 whitespace-pre-wrap">{r.content}</p></div>)}</details></div><div className={panel}><h3 className="font-semibold">变更影响与审批记录</h3>{detail.changes.map(c => <div key={c.id} className="mt-3 rounded-xl bg-amber-50 p-4 text-sm"><strong>V{c.fromVersion} 变更 · {c.state}</strong><p className="mt-2 whitespace-pre-wrap">{c.reason}</p>{Object.entries(c.impact as Record<string, string>).map(([key, value]) => <p key={key} className="mt-1">{({ scope: "范围", schedule: "工期", cost: "成本", risk: "风险" } as Record<string, string>)[key]}：{value}</p>)}</div>)}{detail.decisions.map(d => <div key={d.id} className="mt-3 border-b border-slate-100 pb-3 text-sm"><p className="font-medium">{labels[d.action.toLowerCase() as RequirementOperation] ?? d.action} · V{d.revisionNumber}</p><p className="mt-1 whitespace-pre-wrap text-slate-600">{d.comment}</p>{d.action === "CLOSE" && <p className="mt-1 text-xs text-teal-800">实际完成：{String((d.evidence as { completedAt?: string }).completedAt ?? "未记录")}</p>}<p className="mt-1 text-xs text-slate-400">{new Date(d.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong" })}</p></div>)}</div></div>}
    {mode && writable && <RequirementDialog title={mode === "edit" ? "编辑需求草稿" : mode === "test-case" ? "新增测试用例" : labels[mode]} busy={busy} onClose={() => setMode(null)}><form onSubmit={submit} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
      {mode === "edit" ? <RequirementFields options={options} detail={detail} /> : mode === "test-case" ? <Field label="测试用例名称"><input autoFocus required name="title" maxLength={191} className={fieldClass} /></Field> : <>
        <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6">正在处理【{revision?.title ?? detail.title}】 · V{version}{mode === "cancel" ? detail.approvedVersion ? "。将提交独立审批，批准取消后不可恢复，证据继续保留。" : "。取消后不可恢复，证据继续保留。" : ""}</p>
        {mode === "link-task" && <Field label="实施任务"><select required name="taskId" className={fieldClass}><option value="">请选择</option>{options.tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>}
        {mode === "record-test" && <><Field label="测试用例"><select required name="testCaseId" className={fieldClass}><option value="">请选择</option>{detail.testCases.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field><Field label="验证结果"><select required name="result" className={fieldClass}><option value="PASSED">通过</option><option value="FAILED">失败</option><option value="BLOCKED">受阻</option></select></Field></>}
        {["customer-confirm", "record-test"].includes(mode) && <Field label={mode === "customer-confirm" ? "客户确认凭证" : "测试报告 / 验证证据"}><select required name="documentId" className={fieldClass}><option value="">请选择已上传的项目文档</option>{options.documents.map(d => <option key={d.id} value={d.id}>{d.filename}</option>)}</select><span className="mt-2 block text-xs font-normal text-slate-500">可先在项目文档上传凭证。这里登记证据，不代表客户本人完成电子签名。</span></Field>}
        {mode === "close" && <Field label="实际完成日期"><input required name="completedAt" type="date" defaultValue={businessToday()} max={businessToday()} className={fieldClass} /><span className="mt-2 block text-xs font-normal text-slate-500">记录需求实际交付完成日期，不能晚于今天。</span></Field>}
        {mode === "change" && <>{[["scope", "范围影响"], ["schedule", "工期影响"], ["cost", "成本影响"], ["risk", "风险影响"]].map(([name, label]) => <Field key={name} label={label}><textarea required name={name} maxLength={1000} rows={2} className={fieldClass} /></Field>)}</>}
        <Field label={mode === "change" ? "变更原因" : mode === "cancel" ? "取消原因" : "处理说明"}><textarea autoFocus name="comment" required={["approve", "approve-cancel", "return-cancel", "withdraw-change", "return", "customer-confirm", "record-test", "request-fix", "change", "cancel", "comment"].includes(mode)} minLength={["approve", "approve-cancel", "return-cancel", "withdraw-change", "return", "customer-confirm", "request-fix", "change", "cancel"].includes(mode) ? 10 : undefined} maxLength={2000} rows={3} className={fieldClass} /></Field>
        {["approve", "approve-cancel"].includes(mode) && <Field label={mode === "approve-cancel" ? "签名密码 · 批准取消需求" : "签名密码 · 批准需求及验收标准"}><input required type="password" name="signaturePassword" autoComplete="current-password" maxLength={72} className={fieldClass} /></Field>}
      </>}
      <div className="flex justify-end gap-3 pt-3"><Button type="button" variant="outline" onClick={() => setMode(null)}>返回</Button><Button type="submit" variant={mode === "cancel" ? "destructive" : "default"}>{busy ? "正在保存…" : "确认并保存"}</Button></div></fieldset></form></RequirementDialog>}
  </section>;
}
