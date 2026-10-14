import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getUser }));
import Home from "./page";

describe("home navigation", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("offers login and registration when unauthenticated", async () => {
    getUser.mockResolvedValue(null);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/register"');
    expect(html).not.toContain('href="/profile"');
  });
  it("offers profile when authenticated", async () => {
    getUser.mockResolvedValue({ id: "verified-user", role: "MEMBER" });
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('href="/profile"');
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/users"');
  });
  it("offers user management only to ADMIN", async () => {
    getUser.mockResolvedValue({ id: "admin", role: "ADMIN" });
    expect(renderToStaticMarkup(await Home())).toContain('href="/users"');
  });
  it("keeps home content but does not claim logged out when identity lookup fails", async () => {
    getUser.mockRejectedValue(new Error("database unavailable"));
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("登录状态暂时无法确认");
    expect(html).toContain("让医疗软件交付更可追溯，也更可控。");
    expect(html).not.toContain('href="/login"');
  });
});
