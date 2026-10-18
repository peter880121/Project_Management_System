import { expect, it } from "vitest";
import { SIGNATURE_REASONS, signatureSchema } from "./signature";

it.each(SIGNATURE_REASONS)("accepts the shared signature intent %s", signatureReason => {
  expect(signatureSchema.safeParse({ signaturePassword: "Synthetic-password", signatureReason }).success).toBe(true);
});
it.each([undefined, "", "确认", "确认开发完成 ", "arbitrary"])("rejects missing or tampered intent %s", signatureReason => {
  expect(signatureSchema.safeParse({ signaturePassword: "Synthetic-password", signatureReason }).success).toBe(false);
});
it.each([undefined, "", "密".repeat(25)])("rejects missing or overlong passwords", signaturePassword => {
  expect(signatureSchema.safeParse({ signaturePassword, signatureReason: SIGNATURE_REASONS[0] }).success).toBe(false);
});
