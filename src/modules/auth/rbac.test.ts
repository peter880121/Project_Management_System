import { describe, expect, it } from "vitest";
import { requireRole } from "./rbac";

describe("requireRole", () => {
  it("returns 401 when there is no authenticated user", async () => {
    const response = requireRole(null, ["ADMIN"]);
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("returns 403 when the authenticated role is not allowed", async () => {
    const response = requireRole({ id: "member-id", role: "MEMBER" }, ["ADMIN", "QA"]);
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("allows a permitted role", () => {
    expect(requireRole({ id: "qa-id", role: "QA" }, ["ADMIN", "QA"])).toBeNull();
  });
});
