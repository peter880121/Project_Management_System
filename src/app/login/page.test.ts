import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { getUser, redirectMock } = vi.hoisted(() => ({ getUser: vi.fn(), redirectMock: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getUser }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("./login-form", () => ({ LoginForm: ({ target }: { target: string }) => createElement("form", { "data-target": target }) }));

import LoginPage from "./page";

describe("login server page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  });
  it("renders the form and preserves a safe target when unauthenticated", async () => {
    getUser.mockResolvedValue(null);
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next: "/profile" }) }));
    expect(html).toContain('data-target="/profile"');
    expect(html).toContain("/register?next=%2Fprofile");
    expect(redirectMock).not.toHaveBeenCalled();
  });
  it("redirects authenticated users home regardless of next, without catching the redirect", async () => {
    getUser.mockResolvedValue({ id: "user-id", role: "MEMBER" });
    await expect(LoginPage({ searchParams: Promise.resolve({ next: "/profile" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });
  it("shows a retry page rather than a login form when identity lookup fails", async () => {
    getUser.mockRejectedValue(new Error("database unavailable"));
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("暂时无法加载，请重试");
    expect(html).not.toContain("<form");
    expect(redirectMock).not.toHaveBeenCalled();
  });
  it("falls back home for an unsafe target", async () => {
    getUser.mockResolvedValue(null);
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next: "//evil.com" }) }));
    expect(html).toContain('data-target="/"');
    expect(html).not.toContain("evil.com");
  });
});
