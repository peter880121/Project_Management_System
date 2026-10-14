import { describe, expect, it } from "vitest";
import { getSafeRedirect, isSafeRedirect } from "./redirect";

describe("safe login redirects", () => {
  it.each(["/", "/profile", "/projects?tab=active", "/projects#tasks"])("accepts %s", (path) => {
    expect(isSafeRedirect(path)).toBe(true);
    expect(getSafeRedirect(path)).toBe(path);
  });
  it.each([
    undefined, ["/profile", "/"], "", "profile", "https://evil.com", "//evil.com",
    "/https:evil", "/\\evil.com", "/login", "/register", "/login?next=/profile",
    "/register/#form", "/LOGIN", "/a/../login", "/%6cogin", "/%256cogin",
    "/%2fevil.com", "/%5cevil.com", "/%3aevil", "/%", "/\nevil.com",
  ])("falls back to home for %j", (path) => {
    expect(isSafeRedirect(path)).toBe(false);
    expect(getSafeRedirect(path)).toBe("/");
  });
});
