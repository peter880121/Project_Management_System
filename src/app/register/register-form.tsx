"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormField } from "@/components/auth/form-field";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  buildRegistrationRequest, registrationErrorField, validateRegistration,
  type RegisterErrors, type RegisterField, type RegisterValues,
} from "@/modules/auth/register-form";

const fields: Array<{ name: RegisterField; label: string; type: string; autoComplete: string; help?: string }> = [
  { name: "name", label: "姓名", type: "text", autoComplete: "name" },
  { name: "email", label: "邮箱", type: "email", autoComplete: "email" },
  { name: "password", label: "密码", type: "password", autoComplete: "new-password", help: "至少 8 位，包含字母和数字，最多 72 字节。" },
  { name: "confirmPassword", label: "确认密码", type: "password", autoComplete: "new-password" },
  { name: "inviteCode", label: "邀请码（可选）", type: "text", autoComplete: "off", help: "有效邀请码可激活账号；不填写则等待管理员激活。" },
];
const uncertainResult = "无法确认注册结果，如果账号已创建，请直接登录";

export function RegisterForm({ loginHref }: { loginHref: string }) {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState<"ACTIVE" | "PENDING" | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const messageBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) messageBox.current?.focus(); }, [message]);

  function focusField(name: RegisterField) {
    const input = formRef.current?.elements.namedItem(name);
    if (input instanceof HTMLInputElement) input.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const values: RegisterValues = {
      name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""), confirmPassword: String(data.get("confirmPassword") ?? ""),
      inviteCode: String(data.get("inviteCode") ?? ""),
    };
    const nextErrors = validateRegistration(values);
    setErrors(nextErrors);
    setMessage("");
    setShowLogin(false);
    const firstError = fields.find((field) => nextErrors[field.name]);
    if (firstError) { focusField(firstError.name); return; }
    submitting.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(buildRegistrationRequest(values)),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const status = body && typeof body === "object" && "status" in body ? body.status : undefined;
        if (status === "ACTIVE" || status === "PENDING") {
          form.reset();
          setSuccess(status);
          setMessage(status === "ACTIVE" ? "注册成功，请登录" : "注册成功，等待管理员激活");
        } else {
          // Keep all input, including passwords, when the outcome cannot be confirmed.
          setMessage(uncertainResult);
        }
        setShowLogin(true);
      } else {
        const error = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "注册失败，请稍后重试";
        const field = registrationErrorField(error);
        if (field) { setErrors({ [field]: error }); focusField(field); }
        else setMessage(response.status === 409 ? "无法完成注册" : error);
      }
    } catch {
      setMessage(uncertainResult);
      setShowLogin(true);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  // Focus a server-rejected field only after the disabled fieldset is enabled again.
  useEffect(() => {
    if (!pending && !message) {
      const firstError = fields.find((field) => errors[field.name]);
      if (firstError) focusField(firstError.name);
    }
  }, [pending, errors, message]);

  return <div className="space-y-5">
    {message && <FormMessage ref={messageBox} message={message} kind={success ? "success" : "error"} />}
    {success === "PENDING" && <p className="text-sm text-slate-600">管理员激活账号后才能登录。</p>}
    {showLogin && <Link href={loginHref} className="inline-block text-teal-800 underline">前往登录</Link>}
    {!success && <form ref={formRef} onSubmit={submit} noValidate className="space-y-5" aria-busy={pending}>
      <fieldset disabled={pending} className="space-y-5">
        {fields.map((field) => <FormField key={field.name} id={field.name} name={field.name} label={field.label}
          type={field.type} autoComplete={field.autoComplete} help={field.help}
          required={field.name !== "inviteCode"} error={errors[field.name]} />)}
        <SubmitButton pending={pending} label="注册" pendingLabel="注册中…" />
      </fieldset>
    </form>}
  </div>;
}
