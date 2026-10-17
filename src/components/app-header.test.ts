import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
const mocks = vi.hoisted(() => ({ user: vi.fn(), identity: vi.fn(), pathname: "/" }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.identity } } }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ replace: vi.fn() }) }));
import { AppHeader } from "./app-header";
const render = async () => renderToStaticMarkup(await AppHeader({ children: createElement("p", null, "protected-page-content") }));

describe("shared application navigation", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.pathname = "/"; mocks.identity.mockResolvedValue({ name: "Synthetic Engineer", email: "synthetic@medpm.local" }); });
  it.each(["/login", "/register"])("preserves guest navigation on %s", async pathname => {
    mocks.pathname = pathname;
    mocks.user.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain('href="/login"'); expect(html).toContain('href="/register"');
    expect(html).toContain('href="/"'); expect(html).not.toContain("登出");
    expect(mocks.identity).not.toHaveBeenCalled();
  });
  it("lets the guest homepage own its navigation", async () => {
    mocks.user.mockResolvedValue(null);
    const html = await render();
    expect(html).not.toContain('aria-label="主导航"');
    expect(html).not.toContain("全局侧边栏");
    expect(html).toContain("protected-page-content");
  });
  it.each(["ADMIN", "QA", "PM", "MEMBER"])("renders the correct %s entries and current user", async role => {
    mocks.user.mockResolvedValue({ id: "verified-user", role });
    const html = await render();
    expect(html).toContain("Synthetic Engineer"); expect(html).toContain("登出");
    expect(html).toContain('href="/profile"'); expect(html).not.toContain('href="/login"');
    expect(html.includes('href="/users"')).toBe(role === "ADMIN");
    expect(html.includes('href="/audit"')).toBe(["ADMIN", "QA"].includes(role));
  });
  it.each(["session", "identity"])("shows retry on %s failure instead of claiming logged out", async part => {
    mocks.user.mockResolvedValue({ id: "verified-user", role: "MEMBER" });
    (part === "session" ? mocks.user : mocks.identity).mockRejectedValue(new Error("unavailable"));
    const html = await render();
    expect(html).toContain("暂时无法加载，请重试"); expect(html).not.toContain('href="/login"');
    expect(html).not.toContain("全局侧边栏"); expect(html).not.toContain("protected-page-content");
  });
  it("only selects display identity fields for the verified user", async () => {
    mocks.user.mockResolvedValue({ id: "verified-user", role: "MEMBER" });
    await render();
    expect(mocks.identity).toHaveBeenCalledWith({ where: { id: "verified-user" }, select: { name: true, email: true } });
  });
});
