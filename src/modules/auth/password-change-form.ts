export type PasswordChangeValues = { currentPassword: string; newPassword: string; confirmPassword: string };
export type PasswordChangeField = keyof PasswordChangeValues;
export type PasswordChangeErrors = Partial<Record<PasswordChangeField, string>>;

export function validatePasswordChange(values: PasswordChangeValues): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {};
  if (!values.currentPassword) errors.currentPassword = "请输入当前密码";
  else if (values.currentPassword.length > 1024) errors.currentPassword = "当前密码输入过长";
  if (values.newPassword.length < 8 || !/\p{L}/u.test(values.newPassword) || !/[0-9]/.test(values.newPassword)) {
    errors.newPassword = "新密码至少 8 位，且必须包含字母和数字";
  } else if (new TextEncoder().encode(values.newPassword).length > 72) errors.newPassword = "密码不能超过 72 字节";
  if (!values.confirmPassword) errors.confirmPassword = "请再次输入新密码";
  else if (values.confirmPassword !== values.newPassword) errors.confirmPassword = "两次输入的密码不一致";
  return errors;
}

// 后端文案变更需同步，未识别的错误保留为表单级提示。
export function passwordChangeErrorField(error: string): PasswordChangeField | undefined {
  if (error === "当前密码不正确") return "currentPassword";
  if (error === "密码不能超过 72 字节" || error === "新密码至少 8 位，且必须包含字母和数字") return "newPassword";
  return undefined;
}
