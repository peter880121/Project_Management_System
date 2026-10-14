"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormField } from "@/components/auth/form-field";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { passwordChangeErrorField, validatePasswordChange, type PasswordChangeErrors, type PasswordChangeField } from "@/modules/auth/password-change-form";

type Props = { busy: boolean; acquire: () => boolean; release: () => void };
const fields: Array<{ name: PasswordChangeField; label: string; autoComplete: string }> = [
  { name: "currentPassword", label: "当前密码", autoComplete: "current-password" },
  { name: "newPassword", label: "新密码", autoComplete: "new-password" },
  { name: "confirmPassword", label: "确认新密码", autoComplete: "new-password" },
];

export function PasswordForm({ busy, acquire, release }: Props) {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<PasswordChangeErrors>({});
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [directLogin, setDirectLogin] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) messageRef.current?.focus(); }, [message]);
  useEffect(() => {
    if (!busy && !message) {
      const first = fields.find((field) => errors[field.name]);
      const input = first && formRef.current?.elements.namedItem(first.name);
      if (input instanceof HTMLInputElement) input.focus();
    }
  }, [busy, errors, message]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || needsLogin) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = { currentPassword: String(data.get("currentPassword") ?? ""), newPassword: String(data.get("newPassword") ?? ""), confirmPassword: String(data.get("confirmPassword") ?? "") };
    const nextErrors = validatePasswordChange(values);
    setErrors(nextErrors);
    setSuccess(false);
    setMessage("");
    if (Object.keys(nextErrors).length || !acquire()) return;
    setPending(true);
    try {
      const response = await fetch("/api/users/me/password", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
      });
      if (response.ok) {
        // The browser accepts the rotated HttpOnly cookie from Set-Cookie automatically.
        form.reset();
        setSuccess(true);
        setMessage("密码已更新，当前设备保持登录，其他设备需要重新登录");
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const error = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "密码修改失败，请重试";
      if (response.status === 401 || response.status === 409) {
        form.reset();
        setNeedsLogin(true);
        setDirectLogin(response.status === 401);
        setMessage(response.status === 401 ? "当前会话已失效，请重新登录后重试" : "密码状态已变化，请先登出，再重新登录后重试");
      } else {
        const field = response.status === 400 ? passwordChangeErrorField(error) : undefined;
        if (field) setErrors({ [field]: error });
        else setMessage("密码修改失败，请重试");
      }
    } catch {
      form.reset();
      setNeedsLogin(true);
      setDirectLogin(false);
      setMessage("无法确认密码修改结果，请先登出，再重新登录确认");
    } finally { setPending(false); release(); }
  }

  return <form ref={formRef} onSubmit={submit} noValidate className="space-y-5" aria-busy={pending}>
    {message && <FormMessage ref={messageRef} message={message} kind={success ? "success" : "error"} />}
    {directLogin && <Link href="/login?next=/profile" className="inline-block text-teal-800 underline">重新登录</Link>}
    <fieldset disabled={busy || needsLogin} className="space-y-5">
      {fields.map((field) => <FormField key={field.name} id={field.name} name={field.name} label={field.label} type="password"
        autoComplete={field.autoComplete} required error={errors[field.name]}
        help={field.name === "newPassword" ? "至少 8 位，包含字母和数字，最多 72 字节。" : undefined} />)}
      <SubmitButton pending={pending} label="修改密码" pendingLabel="修改中…" />
    </fieldset>
  </form>;
}
