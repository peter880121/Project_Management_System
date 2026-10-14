"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/auth/form-field";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { createUserSchema, roles, type CreateUserInput } from "@/modules/users/schemas";
import { UserDialog } from "./user-dialog";

export function CreateUserDialog({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (input: CreateUserInput) => Promise<void> }) {
  const [errors, setErrors] = useState<Partial<Record<keyof CreateUserInput, string>>>({});
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || busy) return;
    const form = event.currentTarget;
    const parsed = createUserSchema.safeParse(Object.fromEntries(new FormData(form)));
    setMessage(""); setErrors({});
    if (!parsed.success) {
      const fields: Partial<Record<keyof CreateUserInput, string>> = {};
      for (const issue of parsed.error.issues) fields[issue.path[0] as keyof CreateUserInput] ??= issue.message;
      setErrors(fields);
      const input = form.elements.namedItem(String(parsed.error.issues[0].path[0]));
      if (input instanceof HTMLElement) input.focus();
      return;
    }
    lock.current = true;
    try { await onCreate(parsed.data); form.reset(); onClose(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "创建失败，请重试"); }
    finally { lock.current = false; }
  }
  return <UserDialog title="创建用户" busy={busy} onClose={onClose}>
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-4">
      {message && <FormMessage message={message} />}
      <fieldset disabled={busy} className="space-y-4">
        <FormField id="create-name" name="name" label="姓名" required error={errors.name} autoComplete="off" />
        <FormField id="create-email" name="email" label="邮箱" type="email" required error={errors.email} autoComplete="off" />
        <div className="text-sm font-medium"><label htmlFor="create-role">角色</label><select id="create-role" name="role" className="mt-2 block w-full rounded-md border border-slate-300 p-2" defaultValue="MEMBER">{roles.map((role) => <option key={role}>{role}</option>)}</select></div>
        <FormField id="create-password" name="initialPassword" label="初始密码" type="password" autoComplete="new-password" required error={errors.initialPassword} help="至少 8 位，包含字母和数字，最多 72 字节。请通过受控渠道告知使用者。" />
        <SubmitButton pending={busy} label="确认创建" pendingLabel="创建中…" />
      </fieldset>
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
    </form>
  </UserDialog>;
}
