"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDialogToasts, ToastViewport, useToast } from "@/components/toast-provider";
import { announceTaskCreated } from "@/components/projects/task-refresh";
import { matchingMembers, memberSearchSeed, type SuggestedMember } from "@/modules/ai/meetings/member-match";
import type { MeetingActionItem } from "@/modules/ai/meetings/types";
import { TaskPlanFields, taskPlanFormValues } from "@/components/tasks/task-plan-fields";
import { createTaskSchema } from "@/modules/tasks/create-schema";

export function ActionItemTaskDialog({ projectId, meetingId, rowVersion, item, onClose, onCreated }: { projectId: string; meetingId: string; rowVersion: number; item: MeetingActionItem; onClose: () => void; onCreated: (taskId: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null); const controller = useRef<AbortController | null>(null); const lock = useRef(false);
  const [title, setTitle] = useState(item.text.slice(0, 191)); const [members, setMembers] = useState<SuggestedMember[]>([]); const [query, setQuery] = useState(memberSearchSeed(item.suggestedAssigneeName)); const [assignee, setAssignee] = useState(""); const [consent, setConsent] = useState(false); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const router = useRouter(); const { notify } = useToast(); useDialogToasts();
  useEffect(() => {
    const element = ref.current; element?.showModal(); const ac = new AbortController(); controller.current = ac;
    void fetch(`/api/users/options?projectId=${projectId}`, { cache: "no-store", signal: ac.signal }).then(async res => {
      const body = await res.json(); if (!res.ok) throw new Error(body.error || "成员加载失败");
      if (!ac.signal.aborted) setMembers(body.data);
    }).catch(e => { if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "成员加载失败"); }).finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => { ac.abort(); element?.close(); };
  }, [projectId]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (lock.current) return; const fields = new FormData(event.currentTarget as HTMLFormElement); lock.current = true; setBusy(true); setError("");
    try {
      const parsed = createTaskSchema.safeParse({ title, assigneeId: assignee, ...taskPlanFormValues(fields), meetingSource: { meetingId, actionItemId: item.id, suggestionId: item.suggestionId, expectedVersion: rowVersion, visibilityExpansionConfirmed: true } });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "请填写任务计划");
      const response = await fetch(`/api/projects/${projectId}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.current?.signal, body: JSON.stringify(parsed.data) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "任务创建失败");
      const taskId = body.data.id as string;
      onCreated(taskId); announceTaskCreated(projectId); router.refresh();
      notify("行动项已转为任务", "success", { label: "去看看任务", href: `/projects/${projectId}/board?taskId=${taskId}` }); onClose();
    } catch (e) { if (!controller.current?.signal.aborted) setError(e instanceof Error ? e.message : "连接中断，请刷新纪要核对转换状态后重试"); }
    finally { lock.current = false; setBusy(false); }
  }
  const visible = matchingMembers(members, query);
  return <dialog ref={ref} aria-label="行动项转为任务" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} className="m-auto w-[min(94vw,560px)] rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-950/45"><form onSubmit={submit} className="space-y-5 p-6"><div><p className="text-xs font-medium text-teal-700">人工确认 · 不自动执行</p><h2 className="mt-1 text-xl font-semibold">将行动项转为任务</h2></div>
    <label className="block text-sm">任务名称<input required maxLength={191} value={title} onChange={e => setTitle(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 p-3" /></label>
    <div className="rounded-xl bg-teal-50 p-4"><p className="mb-3 text-xs text-teal-900">AI 建议负责人：{item.suggestedAssigneeName || "待确认"} · 请人工选择项目成员</p><label className="block text-sm">搜索负责人<input aria-label="搜索负责人" value={query} onChange={e => { setQuery(e.target.value); setAssignee(""); }} placeholder="姓名模糊搜索，例如：张" className="mt-2 w-full rounded-lg border border-teal-200 bg-white p-2.5" /></label><label className="mt-3 block text-sm">负责人<select required aria-label="负责人" disabled={loading || busy} value={assignee} onChange={e => setAssignee(e.target.value)} className="mt-2 w-full rounded-lg border border-teal-200 bg-white p-2.5"><option value="">{loading ? "正在加载成员…" : "请选择负责人"}</option>{visible.map(member => <option key={member.id} value={member.id}>{member.name}{member.id === item.suggestedAssigneeId ? " · AI 建议" : ""}</option>)}</select></label>{query && <div className="mt-2 flex items-center justify-between text-xs text-teal-800"><span>匹配 {visible.length} 位成员</span><button type="button" onClick={() => { setQuery(""); setAssignee(""); }} className="border-0 underline">显示全部成员</button></div>}</div>
    <TaskPlanFields defaultPhase="会议行动项" defaultDueDate={item.expectedDueDate ?? ""} dueDateRequired={false} />
    <label className="flex gap-2 text-xs leading-6 text-slate-600"><input required type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />我确认以上内容，知悉任务对项目成员可见；会议原文不会复制到任务。</label>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">取消</button><button disabled={busy || loading || !assignee || !consent} className="rounded-lg bg-teal-800 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "正在创建…" : "确认创建任务"}</button></div></form><ToastViewport /></dialog>;
}
