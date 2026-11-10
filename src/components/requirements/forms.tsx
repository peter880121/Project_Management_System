"use client";
import { Children, cloneElement, isValidElement, useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ToastViewport, useDialogToasts } from "@/components/toast-provider";
import { businessToday } from "@/modules/tasks/plan";
import { categoryLabels, priorityLabels } from "@/modules/requirements/schemas";
import type { requirementOptions, loadRequirement } from "@/modules/requirements/repositories";

export type JsonDates<T> = T extends Date ? string : T extends (infer U)[] ? JsonDates<U>[] : T extends object ? { [K in keyof T]: JsonDates<T[K]> } : T;
export type Detail = NonNullable<JsonDates<Awaited<ReturnType<typeof loadRequirement>>>>;
export type Options = Awaited<ReturnType<typeof requirementOptions>>;
export const fieldClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:bg-slate-100 disabled:text-slate-500";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700">{label}{Children.map(children, child => isValidElement<{ "aria-label"?: string }>(child) && typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type) ? cloneElement(child, { "aria-label": child.props["aria-label"] ?? label }) : child)}</label>;
}
export function RequirementDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const element = useRef<HTMLDialogElement>(null); useDialogToasts();
  useEffect(() => { const old = document.activeElement as HTMLElement | null; const node = element.current; node?.showModal(); node?.querySelector<HTMLElement>("input:not([type=hidden]),textarea,select")?.focus(); return () => { node?.close(); old?.focus(); }; }, []);
  return <dialog ref={element} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} aria-label={title} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/40"><div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">{title}</h2><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>关闭</Button></div>{children}<ToastViewport /></dialog>;
}
export function ImageInput() { return <Field label="需求图片（可选，最多 8 张）"><input aria-label="需求图片" name="images" type="file" multiple accept="image/png,image/jpeg,image/webp" className={fieldClass} /><span className="mt-2 block text-xs font-normal leading-5 text-slate-500">支持 PNG、JPEG、WebP，每张不超过 5 MB。可上传界面截图或业务流程图，请勿包含真实患者信息。提交评审后附件锁定。</span></Field>; }
export function RequirementFields({ options, detail, source }: { options: Options; detail?: Detail; source?: { title: string; content: string } }) {
  const revision = detail?.revisions.find(r => r.version === (detail.draftVersion ?? detail.approvedVersion));
  const meta = (revision?.metadata ?? {}) as Record<string, string | null>;
  return <>
    <Field label="需求标题"><input autoFocus required name="title" maxLength={191} defaultValue={revision?.title ?? source?.title ?? ""} className={fieldClass} /></Field>
    <Field label="需求说明"><textarea required name="content" rows={5} maxLength={20000} defaultValue={revision?.content ?? source?.content ?? ""} placeholder="业务背景、使用场景、明确的范围与边界" className={fieldClass} /></Field>
    <Field label="验收标准"><textarea required minLength={5} maxLength={10000} name="acceptanceCriteria" rows={3} defaultValue={revision?.acceptanceCriteria ?? ""} placeholder="描述可以逐项验证的预期行为和通过条件" className={fieldClass} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="预计完成日期"><input required type="date" name="dueDate" defaultValue={revision?.dueDate.slice(0, 10) ?? businessToday()} className={fieldClass} /></Field><Field label="需求负责人"><select required name="ownerId" defaultValue={meta.ownerId ?? detail?.ownerId ?? ""} className={fieldClass}><option value="">请选择项目成员</option>{options.members.map(m => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}</select></Field></div>
    <div className="grid gap-4 sm:grid-cols-3"><Field label="优先级"><select name="priority" defaultValue={meta.priority ?? detail?.priority ?? "SHOULD"} className={fieldClass}>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="需求类型"><select name="category" defaultValue={meta.category ?? detail?.category ?? "FUNCTIONAL"} className={fieldClass}>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="风险等级"><select name="riskLevel" defaultValue={meta.riskLevel ?? detail?.riskLevel ?? "NORMAL"} className={fieldClass}><option value="NORMAL">一般</option><option value="HIGH">高风险</option></select></Field></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="发现阶段"><input name="discoveryPhase" maxLength={50} defaultValue={meta.discoveryPhase ?? detail?.discoveryPhase ?? ""} placeholder="如：验证与测试、上线维护" className={fieldClass} /></Field><Field label="目标交付版本"><input name="targetRelease" maxLength={100} defaultValue={meta.targetRelease ?? detail?.targetRelease ?? ""} placeholder="如：首期上线 V1.0" className={fieldClass} /></Field></div>
    <ImageInput />
  </>;
}
export function requirementFormData(form: FormData) {
  const text = (key: string) => String(form.get(key) ?? "");
  return { title: text("title"), content: text("content"), acceptanceCriteria: text("acceptanceCriteria"), dueDate: text("dueDate"), ownerId: text("ownerId") || null, priority: text("priority"), category: text("category"), riskLevel: text("riskLevel"), discoveryPhase: text("discoveryPhase"), targetRelease: text("targetRelease") };
}
export function selectedImages(form: FormData) {
  const files = form.getAll("images").filter((v): v is File => v instanceof File && v.size > 0);
  if (files.length > 8 || files.some(f => f.size > 5 * 1024 * 1024)) throw new Error("最多上传 8 张图片，每张不超过 5 MB");
  if (files.some(f => !/\.(png|jpe?g|webp)$/i.test(f.name))) throw new Error("仅支持 PNG、JPEG、WebP 图片");
  return files;
}
export async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }); const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "操作失败，请稍后重试"); return body.data;
}
export async function uploadImages(projectId: string, type: "requirements" | "requirement-intakes", id: string, version: number, files: File[]) {
  for (const file of files) { const form = new FormData(); form.set("file", file); form.set("expectedRowVersion", String(version)); await jsonRequest(`/api/projects/${projectId}/${type}/${id}/images`, { method: "POST", body: form }); version++; }
}
