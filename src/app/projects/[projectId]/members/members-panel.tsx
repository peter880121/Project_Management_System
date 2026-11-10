"use client";
import { useProjectCapabilities } from "@/components/projects/capabilities-context";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
type Snapshot = { ownerId: string; canManage: boolean; members: { userId: string; active: boolean; canOverrideAcceptance: boolean; version: number; user: { name: string; role: string } }[]; candidates: { id: string; name: string; role: string }[] };
export function MembersPanel({ projectId, onboarding = false, navigationBusy = false, onSaved }: { projectId: string; onboarding?: boolean; navigationBusy?: boolean; onSaved?: () => void }) {
  const { capabilities } = useProjectCapabilities(); const canManage = capabilities?.canManageMembers ?? true;
  const [data, setData] = useState<Snapshot>(); const [selected, setSelected] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const response = await fetch(`/api/projects/${projectId}/members`); const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body); }, [projectId]);
  useEffect(() => { void load().catch((e) => setError(String(e.message))); }, [load]);
  async function save(userId: string, active: boolean, canOverrideAcceptance?: boolean) { setBusy(true); setError(""); try { const response = await fetch(`/api/projects/${projectId}/members`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, active, ...(canOverrideAcceptance !== undefined ? { canOverrideAcceptance } : {}), expectedVersion: data?.members.find((m) => m.userId === userId)?.version ?? 0 }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); await load(); onSaved?.(); } catch (e) { setError(e instanceof Error ? e.message : "授权失败"); } finally { setBusy(false); } }
  const activeMembers = data?.members.filter(member => member.active) ?? [];
  const ownerName = data?.members.find(member => member.userId === data.ownerId)?.user.name
    ?? data?.candidates.find(user => user.id === data.ownerId)?.name;
  return <section className="space-y-6">
    {onboarding && <section aria-label="新项目引导" className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-5"><p className="text-sm font-semibold text-teal-900">第 1 步 / 共 2 步 · 配置项目成员</p><p className="text-sm leading-7 text-slate-700">配置项目访问权限后，直接进入任务管理分配负责人和安排计划。人员容量可稍后补充。</p><Link aria-disabled={busy || navigationBusy || !data || !!error} tabIndex={busy || navigationBusy || !data || !!error ? -1 : undefined} onClick={event => { if (busy || navigationBusy || !data || error) event.preventDefault(); }} className={`inline-block rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white ${busy || navigationBusy || !data || error ? "opacity-40" : ""}`} href={`/projects/${projectId}/board?onboarding=1`}>完成人员配置，进入任务管理 →</Link></section>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {!data && !error && <p role="status" className="text-sm text-slate-600">正在加载项目成员…</p>}
    {data && <>
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <p className="text-sm font-medium text-slate-900">项目负责人{ownerName ? `：${ownerName}` : ""}</p>
        <p className="mt-2 break-all font-mono text-xs leading-6 text-slate-500">负责人 ID：{data.ownerId ?? "尚未指定"}</p>
        <p className="mt-1 text-sm text-slate-600">负责人默认拥有项目访问权。</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold">已授权成员</h2>
          <span className="text-sm text-slate-500">共 {activeMembers.length} 位</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <caption className="sr-only">项目成员列表</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600"><tr>
              <th scope="col" className="px-5 py-3 font-medium">成员姓名</th>
              <th scope="col" className="px-5 py-3 font-medium">系统角色</th>
              <th scope="col" className="px-5 py-3 font-medium">项目访问权</th>
              {data.canManage && <th scope="col" className="px-5 py-3 text-right font-medium">操作</th>}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {activeMembers.map(member => <tr key={member.userId} className="align-middle hover:bg-slate-50/70">
                <th scope="row" className="max-w-64 break-words px-5 py-4 font-medium text-slate-900">{member.user.name}</th>
                <td className="px-5 py-4"><span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{member.user.role}</span></td>
                <td className="whitespace-nowrap px-5 py-4 text-slate-600">{member.userId === data.ownerId ? "负责人默认授权" : "已授权"}</td>
                {data.canManage && <td className="px-5 py-4 text-right">{member.userId === data.ownerId
                  ? <span className="whitespace-nowrap text-xs text-slate-400">负责人不可移出</span>
                  : <Button type="button" variant="outline" size="sm" disabled={busy || !canManage} onClick={() => void save(member.userId, false)}>移出</Button>}</td>}
              </tr>)}
              {activeMembers.length === 0 && <tr><td colSpan={data.canManage ? 4 : 3} className="px-5 py-10 text-center leading-6 text-slate-500">暂无额外授权成员，负责人仍拥有项目访问权。</td></tr>}
              {capabilities?.role === "ADMIN" && activeMembers.filter(member => member.user.role === "PM").map(member => <tr key={`override:${member.userId}`}><td colSpan={4} className="bg-amber-50/70 px-5 py-3 text-xs text-amber-950"><span className="mr-4">{member.user.name} · 验收例外提交权限：{member.canOverrideAcceptance ? "已授权" : "未授权"}</span><Button size="sm" variant="outline" disabled={busy || !canManage} onClick={() => void save(member.userId, true, !member.canOverrideAcceptance)}>{member.canOverrideAcceptance ? "撤销例外权限" : "授予例外权限"}</Button></td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      {capabilities?.role === "ADMIN" && data.ownerId && !data.members.some(m => m.userId === data.ownerId && m.active) && data.candidates.some(c => c.id === data.ownerId && c.role === "PM") && <Button disabled={busy || !canManage} variant="outline" onClick={() => void save(data.ownerId, true, true)}>授予负责人验收例外权限</Button>}
      {data.canManage && <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">添加项目成员</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 space-y-2 text-sm font-medium text-slate-700">选择成员
            <select aria-label="待添加成员" disabled={busy || !canManage} className="block h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal" value={selected} onChange={event => setSelected(event.target.value)}>
              <option value="">选择成员</option>{data.candidates.filter(user => user.id !== data.ownerId && !data.members.some(member => member.userId === user.id && member.active)).map(user => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}
            </select>
          </label>
          <Button type="button" className="shrink-0" disabled={busy || !selected || !canManage} onClick={() => void save(selected, true)}>添加成员</Button>
        </div>
      </div>}
    </>}
  </section>;
}
