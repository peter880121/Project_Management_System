import { describe, expect, it } from "vitest";
import { createUserSchema, parseListUsersQuery, statusSchema } from "./schemas";
describe("user management inputs", () => {
  it("combines filters with bounded pagination", () => {
    expect(parseListUsersQuery(new URLSearchParams("role=QA&status=ACTIVE&keyword=synthetic&page=2&pageSize=10"))).toMatchObject({ success: true, data: { role: "QA", status: "ACTIVE", keyword: "synthetic", page: 2, pageSize: 10 } });
  });
  it.each(["page=1.5", "pageSize=-1", "page=Infinity", "status=OTHER", "keyword=" + "a".repeat(192)])("rejects %s", (query) => {
    expect(parseListUsersQuery(new URLSearchParams(query)).success).toBe(false);
  });
  it("rejects weak or over-72-byte passwords and accepts exact UTF-8 limit", () => {
    const input = { name: "Synthetic", email: "user@example.test", role: "MEMBER" };
    for (const initialPassword of ["short", "abcdefgh", "12345678", "中".repeat(24) + "A1"]) expect(createUserSchema.safeParse({ ...input, initialPassword }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...input, initialPassword: "中".repeat(23) + "A12" }).success).toBe(true);
  });
  it("does not accept PENDING as a requested target status", () => { expect(statusSchema.safeParse({ status: "PENDING" }).success).toBe(false); });
});
