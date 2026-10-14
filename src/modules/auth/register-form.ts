import { z } from "zod";

export type RegisterValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  inviteCode: string;
};
export type RegisterField = keyof RegisterValues;
export type RegisterErrors = Partial<Record<RegisterField, string>>;

export function validateRegistration(values: RegisterValues): RegisterErrors {
  const errors: RegisterErrors = {};
  if (!values.name.trim()) errors.name = "请输入姓名";
  else if (values.name.trim().length > 191) errors.name = "姓名不能超过 191 个字符";
  if (!z.string().email().max(191).safeParse(values.email.trim()).success) errors.email = "请输入有效的邮箱地址";
  if (values.password.length < 8 || !/\p{L}/u.test(values.password) || !/[0-9]/.test(values.password)) {
    errors.password = "密码至少 8 位，且必须包含字母和数字";
  } else if (new TextEncoder().encode(values.password).length > 72) {
    errors.password = "密码不能超过 72 字节";
  }
  if (!values.confirmPassword) errors.confirmPassword = "请再次输入密码";
  else if (values.password !== values.confirmPassword) errors.confirmPassword = "两次输入的密码不一致";
  if (values.inviteCode.length > 256) errors.inviteCode = "邀请码不能超过 256 个字符";
  return errors;
}

export function buildRegistrationRequest(values: RegisterValues) {
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    password: values.password,
    ...(values.inviteCode.trim() ? { inviteCode: values.inviteCode } : {}),
  };
}

// 后端文案变更需同步：当前 API 没有字段错误结构，仅映射明确的校验文案。
const fieldErrorMappings: Array<{ matches: (error: string) => boolean; field: RegisterField }> = [
  { matches: (error) => error.includes("邀请码"), field: "inviteCode" },
  { matches: (error) => error === "邮箱格式不正确", field: "email" },
  { matches: (error) => error === "密码至少 8 位，且必须包含字母和数字" || error === "密码不能超过 72 字节", field: "password" },
];

export function registrationErrorField(error: string): RegisterField | undefined {
  return fieldErrorMappings.find((mapping) => mapping.matches(error))?.field;
}
