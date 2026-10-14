import { describe, expect, it } from "vitest";
import { passwordChangeErrorField, validatePasswordChange } from "./password-change-form";

const valid = { currentPassword: "OldPassword123", newPassword: "NewPassword456", confirmPassword: "NewPassword456" };
describe("password change form", () => {
  it("accepts valid passwords", () => { expect(validatePasswordChange(valid)).toEqual({}); });
  it("reports missing inputs and rejects mismatching confirmation", () => {
    expect(Object.keys(validatePasswordChange({ currentPassword: "", newPassword: "", confirmPassword: "" })))
      .toEqual(["currentPassword", "newPassword", "confirmPassword"]);
    expect(validatePasswordChange({ ...valid, confirmPassword: `${valid.newPassword} ` }).confirmPassword).toBe("两次输入的密码不一致");
  });
  it.each(["12345678", "abcdefgh", "Abc1234"])("rejects weak new password %s", (newPassword) => {
    expect(validatePasswordChange({ ...valid, newPassword })).toHaveProperty("newPassword");
  });
  it("enforces UTF-8 byte limit without trimming passwords", () => {
    const newPassword = `${"中".repeat(23)}Ab1`;
    expect(validatePasswordChange({ ...valid, newPassword, confirmPassword: newPassword })).toEqual({});
    expect(validatePasswordChange({ ...valid, newPassword: `${newPassword} ` }).newPassword).toBe("密码不能超过 72 字节");
    expect(validatePasswordChange({ ...valid, currentPassword: "a".repeat(1025) })).toHaveProperty("currentPassword");
  });
  it("maps only known backend field errors", () => {
    expect(passwordChangeErrorField("当前密码不正确")).toBe("currentPassword");
    expect(passwordChangeErrorField("密码不能超过 72 字节")).toBe("newPassword");
    expect(passwordChangeErrorField("密码修改失败，请重试")).toBeUndefined();
  });
});
