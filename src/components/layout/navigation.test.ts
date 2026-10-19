import { describe, expect, it } from "vitest";
import { isActiveNavigation, isProtectedPage, sidebarItems } from "./navigation";

describe("sidebar route and role policy", () => {
  it.each(["MEMBER", "PM", "QA", "ADMIN"] as const)("keeps ordered %s navigation within its role", role => {
    const items = sidebarItems(role);
    expect(items.map(item => item.href)).toEqual(["/", ...(["ADMIN", "PM"].includes(role) ? ["/dashboard"] : []), "/projects", ...(["ADMIN", "QA"].includes(role) ? ["/audit"] : []), ...(role === "ADMIN" ? ["/users"] : []), "/profile"]);
  });
  it("gives PMO dashboard and profile without administrative or project navigation", () => {
    expect(sidebarItems("PMO").map(item => item.href)).toEqual(["/", "/dashboard", "/profile"]);
    expect(isProtectedPage("/dashboard")).toBe(true);
  });
  it("highlights exact home and nested feature pages without prefix collisions", () => {
    expect(isActiveNavigation("/", "/projects")).toBe(false);
    expect(isActiveNavigation("/projects", "/tasks/synthetic-id")).toBe(true);
    expect(isActiveNavigation("/projects", "/projects/synthetic-id/documents")).toBe(true);
    expect(isActiveNavigation("/audit", "/audit/records/synthetic-id")).toBe(true);
    expect(isActiveNavigation("/users", "/users-extra")).toBe(false);
  });
  it("distinguishes protected pages from public authentication routes", () => {
    for (const path of ["/projects", "/tasks/example", "/audit", "/users", "/profile", "/notifications/example"]) expect(isProtectedPage(path)).toBe(true);
    for (const path of ["/", "/login", "/register"]) expect(isProtectedPage(path)).toBe(false);
  });
});
