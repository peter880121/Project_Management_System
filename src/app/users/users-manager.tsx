"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/auth/form-message";
import { roles, statuses, type CreateUserInput, type ListUsersQuery } from "@/modules/users/schemas";
import type { UserListItem, UserListResult } from "@/modules/users/repositories";
import { sendUserMutation, UserRequestError } from "@/modules/users/client";
import { CreateUserDialog } from "./create-user-dialog";
import { UserDialog } from "./user-dialog";

type Change = { user: UserListItem; field: "role" | "status"; value: string };
export function UsersManager({ actorId, initial, query }: { actorId: string; initial: UserListResult; query: ListUsersQuery }) {
  const router = useRouter();
  const [transition, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [change, setChange] = useState<Change | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const busy = pending || transition;
  const disabled = busy || blocked;
  function navigate(next: ListUsersQuery) {
    const params = new URLSearchParams({ page: String(next.page), pageSize: String(next.pageSize) });
    for (const key of ["role", "status", "keyword"] as const) if (next[key]) params.set(key, next[key]);
    startTransition(() => router.push(`/users?${params}`));
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    navigate({ page: 1, pageSize: Number(data.get("pageSize")),
      ...(data.get("role") ? { role: data.get("role") as ListUsersQuery["role"] } : {}),
      ...(data.get("status") ? { status: data.get("status") as ListUsersQuery["status"] } : {}),
      keyword: String(data.get("keyword") ?? "").trim(),
    });
  }
  async function mutate(url: string, method: "POST" | "PATCH", body: unknown) {
    if (lock.current) throw new UserRequestError(0, "操作正在提交");
    lock.current = true; setPending(true); setMessage(""); setSuccess(false);
    try {
      await sendUserMutation(url, method, body);
      setSuccess(true); setMessage("操作已保存并记录审计。"); setDrafts({});
      startTransition(() => router.refresh());
    } catch (error) {
      if (error instanceof UserRequestError && (error.status === 401 || error.status === 403)) {
        setBlocked(true); setCreating(false); setMessage(error.message);
      }
      throw error;
    } finally { lock.current = false; setPending(false); }
  }
  async function confirmChange() {
    if (!change || disabled) return;
    try { await mutate(`/api/users/${change.user.id}/${change.field}`, "PATCH", { [change.field]: change.value }); setChange(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败，请重试"); setChange(null); }
  }
  const pages = Math.max(1, Math.ceil(initial.total / initial.pageSize));
  return <div className="space-y-5" aria-busy={busy}>
    <div className="flex flex-wrap gap-3"><Button disabled={disabled} onClick={() => setCreating(true)}>创建用户</Button><Button variant="outline" disabled={busy} onClick={() => { setBlocked(false); setDrafts({}); startTransition(() => router.refresh()); }}>刷新列表</Button></div>
    {message && <FormMessage message={message} kind={success ? "success" : "error"} />}
    {blocked && <p role="alert">会话或权限已变化，请刷新页面。<Link href="/login?next=/users" className="ml-2 text-teal-800 underline">前往登录</Link></p>}
    <form onSubmit={filter} className="rounded-xl border border-slate-200 bg-white p-4">
      <fieldset disabled={disabled} className="flex flex-wrap items-end gap-4">
        <div className="text-sm"><label htmlFor="filter-role">角色筛选</label><select id="filter-role" name="role" defaultValue={query.role ?? ""} className="mt-1 block rounded-md border border-slate-300 p-2"><option value="">全部角色</option>{roles.map((role) => <option key={role}>{role}</option>)}</select></div>
        <div className="text-sm"><label htmlFor="filter-status">状态筛选</label><select id="filter-status" name="status" defaultValue={query.status ?? ""} className="mt-1 block rounded-md border border-slate-300 p-2"><option value="">全部状态</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></div>
        <label className="text-sm">姓名或邮箱<input name="keyword" maxLength={191} defaultValue={query.keyword ?? ""} className="mt-1 block rounded-md border border-slate-300 p-2" /></label>
        <div className="text-sm"><label htmlFor="filter-size">每页数量</label><select id="filter-size" name="pageSize" defaultValue={query.pageSize} className="mt-1 block rounded-md border border-slate-300 p-2">{[10, 20, 50, 100].map((size) => <option key={size}>{size}</option>)}{![10, 20, 50, 100].includes(query.pageSize) && <option>{query.pageSize}</option>}</select></div>
        <Button type="submit">查询</Button>
      </fieldset>
    </form>
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm"><caption className="sr-only">用户列表</caption>
        <thead className="bg-slate-100"><tr>{["姓名", "邮箱", "角色", "状态", "最后登录（UTC）", "操作"].map((label) => <th scope="col" key={label} className="whitespace-nowrap p-4">{label}</th>)}</tr></thead>
        <tbody>{initial.data.map((user) => {
          const self = user.id === actorId;
          const role = drafts[user.id] ?? user.role;
          return <tr key={user.id} className="border-t border-slate-100">
            <td className="p-4">{user.name}{self && <span className="ml-2 whitespace-nowrap text-xs text-teal-800">当前账号</span>}</td>
            <td className="p-4">{user.email}</td><td className="p-4">{user.role}</td><td className="p-4">{user.status}</td>
            <td className="whitespace-nowrap p-4">{user.lastLoginAt ? new Date(user.lastLoginAt).toISOString().replace("T", " ").replace("Z", " UTC") : "暂无记录"}</td>
            <td className="p-4"><div className="flex flex-wrap items-center gap-2">
              <select aria-label={`修改 ${user.email} 的角色`} disabled={disabled || self} value={role} onChange={(event) => setDrafts((current) => ({ ...current, [user.id]: event.target.value }))} className="rounded-md border border-slate-300 p-2">{roles.map((item) => <option key={item}>{item}</option>)}</select>
              <Button size="sm" variant="outline" disabled={disabled || self || role === user.role} onClick={() => setChange({ user, field: "role", value: role })}>修改角色</Button>
              <Button size="sm" variant={user.status === "ACTIVE" ? "destructive" : "outline"} disabled={disabled || self}
                onClick={() => setChange({ user, field: "status", value: user.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}>{user.status === "ACTIVE" ? "禁用" : user.status === "PENDING" ? "激活" : "重新启用"}</Button>
              {self && <span className="text-xs text-slate-500">不能修改自己的角色或状态</span>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
      {!initial.data.length && <p className="p-8 text-center text-slate-600">没有符合条件的用户</p>}
    </div>
    <div className="flex flex-wrap items-center gap-4">
      <p role="status">共 {initial.total} 个用户，第 {initial.page} / {pages} 页</p>
      <Button variant="outline" disabled={disabled || initial.page <= 1} onClick={() => navigate({ ...query, page: initial.page - 1 })}>上一页</Button>
      <Button variant="outline" disabled={disabled || initial.page >= pages} onClick={() => navigate({ ...query, page: initial.page + 1 })}>下一页</Button>
    </div>
    {creating && <CreateUserDialog busy={busy || blocked} onClose={() => setCreating(false)} onCreate={(input: CreateUserInput) => mutate("/api/users", "POST", input)} />}
    {change && <UserDialog title="确认账号变更" busy={busy} onClose={() => setChange(null)}>
      <p className="mb-3 break-words">目标账号：{change.user.email}</p>
      <p className="mb-3">{change.field === "role" ? "角色" : "状态"}：{change.user[change.field]} → {change.value}</p>
      {change.value === "DISABLED" && <p className="mb-5 text-sm text-red-800">此操作会终止该账号当前有效的全部登录会话，历史数据保留。</p>}
      <div className="mt-5 flex gap-3"><Button disabled={disabled} onClick={() => void confirmChange()}>{pending ? "提交中…" : "确认变更"}</Button><Button variant="outline" disabled={busy} onClick={() => setChange(null)}>取消</Button></div>
    </UserDialog>}
  </div>;
}
