import { describe, expect, it } from "vitest";
import { auditQuerySchema, buildAuditWhere } from "./query";

describe("audit query validation", () => {
  it("accepts a project filter with UTC time bounds", () => {
    const parsed = auditQuerySchema.safeParse({
      projectId: "00000000-0000-4000-8000-000000000001",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(50);
    if (parsed.success) {
      expect(buildAuditWhere(parsed.data)).toEqual({
        projectId: "00000000-0000-4000-8000-000000000001",
        createdAt: { gte: new Date("2026-10-01T00:00:00.000Z"), lte: new Date("2026-10-02T00:00:00.000Z") },
      });
    }
  });

  it("rejects malformed IDs, inverted time ranges, and excessive limits", () => {
    expect(auditQuerySchema.safeParse({ projectId: "project-1" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: "2026-10-02T00:00:00Z", to: "2026-10-01T00:00:00Z" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });
});
