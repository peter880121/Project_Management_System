"use client";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { VersionReview } from "./version-review";

type TestCase = { id: string; title: string; status: string; updatedAt: string; reviewedRequirementVersion: number | null };
type Requirement = { id: string; title: string; content: string; status: string; version: number; managed?: boolean; testCases: TestCase[] };
type TraceData = { requirements: Requirement[]; tasks: { id: string; title: string; requirementId: string | null; updatedAt: string; reviewedRequirementVersion: number | null }[] };
const field = "mt-1 block w-full rounded border border-slate-300 p-2";
const requirementStatuses = ["DRAFT", "IN_REVIEW", "APPROVED", "RETIRED"];
const testStatuses = ["NOT_RUN", "PASSED", "FAILED", "BLOCKED"];

export function TraceabilityManager({ projectId, role, initial }: { projectId: string; role: Role; initial: TraceData }) {
  const { capabilities } = useProjectCapabilities();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  const [feedback, setFeedback] = useState<{ key: string; message: string; failed: boolean; kind: unknown } | null>(null);
  const [highlightedId, setHighlightedId] = useState("");
  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(""), 5000);
    return () => clearTimeout(timer);
  }, [highlightedId]);
  async function retryHistory() {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch(`/api/projects/${projectId}/history-sync`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "重试失败");
      setMessage(`已尝试同步 ${result.data.attemptedTaskIds.length} 项历史任务；失败记录将保留供后续重试。`);
    } catch (cause) { setFailed(true); setMessage(cause instanceof Error ? cause.message : "网络连接失败"); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>, body: Record<string, unknown>, update: boolean) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    const feedbackKey = String(body.id ?? body.requirementId ?? body.kind);
    setFeedback(null);
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch(`/api/projects/${projectId}/traceability`, { method: update ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, ...body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败");
      if (!update) form.reset();
      const noun = body.kind === "testCase" ? "测试用例" : body.kind === "requirement" ? "需求" : "任务关联";
      const notice = `${noun}${values.title ? `《${values.title}》` : ""}已${update ? "保存" : "创建"}，操作已记录审计。`;
      setMessage(notice); setFeedback({ key: feedbackKey, message: notice, failed: false, kind: body.kind });
      setHighlightedId(String(body.id ?? result.data?.id ?? ""));
      router.refresh();
    } catch (cause) {
      const notice = cause instanceof Error ? cause.message : "网络连接失败，输入已保留，请重试";
      setFailed(true); setMessage(notice); setFeedback({ key: feedbackKey, message: notice, failed: true, kind: body.kind });
    } finally { saving.current = false; setBusy(false); }
  }
  function localFeedback(key: string) {
    return feedback?.key === key ? <div role={feedback.failed ? "alert" : "status"} aria-live="polite" className={`rounded-md border p-3 ${feedback.failed ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-400 bg-emerald-50 text-emerald-900"}`}>
      <p>{feedback.message}</p>{!feedback.failed && <Link className="mt-2" href={`/projects/${projectId}/board`}>返回项目看板</Link>}
    </div> : null;
  }
  function requirementFields(item?: Requirement) {
    return <>
      <label className="block text-sm">需求标题<input name="title" required maxLength={191} defaultValue={item?.title} className={field} /></label>
      <label className="block text-sm">需求内容<textarea aria-label="需求内容" name="content" required maxLength={20000} defaultValue={item?.content} className={field} /></label>
      <label className="block text-sm">需求状态<select aria-label="需求状态" name="status" defaultValue={item?.status || "DRAFT"} className={field}>{requirementStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
    </>;
  }
  function testFields(item?: TestCase) {
    return <>
      <label className="block text-sm">测试用例标题<input name="title" required maxLength={191} defaultValue={item?.title} className={field} /></label>
      <label className="block text-sm">测试结果<select aria-label="测试结果" name="status" defaultValue={item?.status || "NOT_RUN"} className={field}>{testStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
    </>;
  }
  return <div className="space-y-6">
    {message && feedback?.kind !== "testCase" && <p role={failed ? "alert" : "status"} className={failed ? "text-red-700" : "text-teal-800"}>{message}</p>}
    <fieldset disabled={capabilities?.writable === false || busy} className="space-y-6">
      {role === "PM" && <section className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">历史检索索引</h2><p className="text-sm text-slate-600">关键词降级会保留待同步任务。服务恢复后可重试，每次最多 5 项，累计失败 5 次后停止自动选取。</p><Button type="button" onClick={() => void retryHistory()}>重试历史任务索引</Button></section>}
      <section className="rounded-xl border border-teal-200 bg-teal-50 p-5"><h2 className="font-semibold">需求统一管理</h2><p className="my-3 text-sm text-slate-600">新需求、图片、预计完成日期、评审和变更统一从需求管理维护。</p><Link className="font-medium text-teal-800 underline" href={`/projects/${projectId}/requirements`}>进入需求管理 →</Link></section>
      {initial.requirements.length === 0 && <p>暂无需求，请由 PM 创建。</p>}
      {initial.requirements.map((requirement) => <section key={`${requirement.id}-${requirement.version}`} className="space-y-4 rounded-xl border bg-white p-5">
        <h2 className="text-xl font-semibold">{requirement.title} · v{requirement.version}</h2>
        {role === "PM" && !requirement.managed ? <form className="space-y-3" onSubmit={(event) => void save(event, { kind: "requirement", id: requirement.id, expectedVersion: requirement.version }, true)}>{requirementFields(requirement)}<Button>保存需求</Button></form> : <><p>{requirement.status}</p><p className="whitespace-pre-wrap">{requirement.content}</p><Link href={`/projects/${projectId}/requirements?requirementId=${requirement.id}`} className="text-sm text-teal-800 underline">查看需求版本与验证证据</Link></>}
        <h3 className="font-semibold">关联任务</h3>
        <ul>{initial.tasks.filter((task) => task.requirementId === requirement.id).map((task) => <li key={task.id}><Link className="text-link text-teal-800 hover:underline" href={`/tasks/${task.id}`}>{task.title}</Link><VersionReview projectId={projectId} entityType="Task" entityId={task.id} requirementId={requirement.id} version={requirement.version} updatedAt={task.updatedAt} reviewedVersion={task.reviewedRequirementVersion} canReview={role === "QA"} /></li>)}</ul>
        <h3 className="font-semibold">测试用例</h3>
        {requirement.testCases.map((item) => <div key={item.id}><p className="text-sm">{item.title}</p><VersionReview projectId={projectId} entityType="TestCase" entityId={item.id} requirementId={requirement.id} version={requirement.version} updatedAt={item.updatedAt} reviewedVersion={item.reviewedRequirementVersion} canReview={role === "QA"} /></div>)}
        {requirement.testCases.length === 0 && <p className="text-sm text-slate-600">尚无测试用例。</p>}
        {requirement.testCases.map((item) => role === "QA" ? <form key={`${item.id}-${item.updatedAt}`} className={`space-y-3 rounded border p-4 ${highlightedId === item.id ? "border-emerald-500 bg-emerald-50" : ""}`} onSubmit={(event) => void save(event, { kind: "testCase", id: item.id, expectedUpdatedAt: item.updatedAt }, true)}>{testFields(item)}<Button disabled={capabilities?.writable === false || busy} aria-busy={busy}>{busy ? "保存中…" : "保存测试用例"}</Button>{localFeedback(item.id)}</form> : <p key={item.id}>{item.title} · {item.status}</p>)}
        {role === "QA" && <form className="space-y-3 rounded border p-4" onSubmit={(event) => void save(event, { kind: "testCase", requirementId: requirement.id }, false)}><h4 className="font-medium">新增测试用例</h4>{testFields()}<Button disabled={capabilities?.writable === false || busy} aria-busy={busy}>{busy ? "保存中…" : "创建测试用例"}</Button>{localFeedback(requirement.id)}</form>}
      </section>)}
      {role === "PM" && <section className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">任务关联需求</h2>{initial.tasks.map((task) => <form key={`${task.id}-${task.requirementId}`} className="space-y-2 rounded border p-3" onSubmit={(event) => {
        const requirementId = new FormData(event.currentTarget).get("requirementId") || null;
        void save(event, { kind: "task", id: task.id, requirementId, expectedRequirementId: task.requirementId }, true);
      }}><Link className="text-link text-teal-800 hover:underline" href={`/tasks/${task.id}`}>{task.title}</Link><label className="block text-sm">关联需求<select aria-label="关联需求" name="requirementId" defaultValue={task.requirementId || ""} className={field}><option value="">未关联</option>{initial.requirements.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><Button>保存关联</Button></form>)}</section>}
    </fieldset>
  </div>;
}
