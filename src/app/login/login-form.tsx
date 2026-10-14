"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { FormField } from "@/components/auth/form-field";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { getSafeRedirect } from "@/modules/auth/redirect";

export function LoginForm({ target }: { target: string }) {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const messageBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) messageBox.current?.focus(); }, [message]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const nextErrors = {
      email: z.string().email().max(191).safeParse(email).success ? undefined : "请输入有效的邮箱地址",
      password: password.length ? undefined : "请输入密码",
    };
    setErrors(nextErrors);
    setMessage("");
    if (nextErrors.email || nextErrors.password) {
      (nextErrors.email ? emailInput : passwordInput).current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        window.location.replace(getSafeRedirect(target));
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const error = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
      setMessage(response.status === 401 ? "邮箱或密码错误"
        : response.status === 403 || response.status === 423 ? error || "暂时无法登录，请稍后重试"
          : "登录失败，请稍后重试");
    } catch {
      setMessage("无法确认登录结果，请检查网络后重试");
    }
    submitting.current = false;
    setPending(false);
  }

  return <form onSubmit={submit} noValidate className="space-y-5" aria-busy={pending}>
    {message && <FormMessage ref={messageBox} message={message} />}
    <fieldset disabled={pending} className="space-y-5">
      <FormField ref={emailInput} id="email" name="email" label="邮箱" type="email" autoComplete="username" required error={errors.email} />
      <FormField ref={passwordInput} id="password" name="password" label="密码" type="password" autoComplete="current-password" required error={errors.password} />
      <SubmitButton pending={pending} label="登录" pendingLabel="登录中…" />
    </fieldset>
  </form>;
}
