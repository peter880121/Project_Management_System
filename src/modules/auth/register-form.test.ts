import { describe, expect, it } from "vitest";
import { buildRegistrationRequest, registrationErrorField, validateRegistration, type RegisterValues } from "./register-form";

const valid: RegisterValues = { name: "Synthetic User", email: "synthetic@medpm.local", password: "Synthetic123", confirmPassword: "Synthetic123", inviteCode: "" };

describe("registration form validation and request", () => {
  it("accepts valid values", () => { expect(validateRegistration(valid)).toEqual({}); });
  it.each(["", " ", "\t\n"])("omits a blank invite %j and never sends confirmation", (inviteCode) => {
    const request = buildRegistrationRequest({ ...valid, inviteCode });
    expect(request).toEqual({ name: valid.name, email: valid.email, password: valid.password });
    expect(request).not.toHaveProperty("inviteCode");
    expect(request).not.toHaveProperty("confirmPassword");
  });
  it("trims name, email and invite but preserves the password exactly", () => {
    expect(buildRegistrationRequest({ ...valid, name: " User ", email: " a@example.test ", password: " Password123 ", inviteCode: " invite " }))
      .toEqual({ name: "User", email: "a@example.test", password: " Password123 ", inviteCode: "invite" });
  });
  it("reports each invalid field", () => {
    const errors = validateRegistration({ name: " ", email: "invalid", password: "short", confirmPassword: "", inviteCode: "a".repeat(257) });
    expect(Object.keys(errors)).toEqual(["name", "email", "password", "confirmPassword", "inviteCode"]);
    expect(validateRegistration({ ...valid, name: "a".repeat(192) })).toHaveProperty("name");
  });
  it.each(["12345678", "abcdefgh", "Abc1234"])("rejects weak password %s", (password) => {
    expect(validateRegistration({ ...valid, password, confirmPassword: password })).toHaveProperty("password");
  });
  it("rejects mismatching confirmation without normalizing passwords", () => {
    expect(validateRegistration({ ...valid, confirmPassword: `${valid.password} ` }).confirmPassword).toBe("两次输入的密码不一致");
  });
  it("counts UTF-8 bytes and accepts the exact bcrypt boundary", () => {
    const password = `${"中".repeat(23)}Ab1`;
    expect(validateRegistration({ ...valid, password, confirmPassword: password })).toEqual({});
    expect(validateRegistration({ ...valid, password: `${password}中` }).password).toBe("密码不能超过 72 字节");
  });
  it("maps known backend wording and leaves generic failures at form level", () => {
    expect(registrationErrorField("邀请码无效")).toBe("inviteCode");
    expect(registrationErrorField("邮箱格式不正确")).toBe("email");
    expect(registrationErrorField("密码不能超过 72 字节")).toBe("password");
    expect(registrationErrorField("无法完成注册")).toBeUndefined();
    expect(registrationErrorField("请求格式无效")).toBeUndefined();
  });
});
