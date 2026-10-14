import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { getUser, redirectMock } = vi.hoisted(() => ({ getUser: vi.fn(), redirectMock: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: getUser }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("./register-form", () => ({ RegisterForm: ({ loginHref }: { loginHref: string }) => createElement("form", { "data-login": loginHref }) }));

import RegisterPage from "./page";

describe("register server page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  });
  it("renders the form with a safe login target when unauthenticated", async () => {
    getUser.mockResolvedValue(null);
    const html = renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve({ next: "/profile" }) }));
    expect(html).toContain('data-login="/login?next=%2Fprofile"');
    expect(redirectMock).not.toHaveBeenCalled();
  });
  it("redirects authenticated users home regardless of next", async () => {
    getUser.mockResolvedValue({ id: "user-id", role: "MEMBER" });
    await expect(RegisterPage({ searchParams: Promise.resolve({ next: "/profile" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });
  it("renders a retry page for identity lookup failures", async () => {
    getUser.mockRejectedValue(new Error("database unavailable"));
    const html = renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("暂时无法加载，请重试");
    expect(html).not.toContain("<form");
  });
  it.each(["//evil.com", "/login", "/register"])("falls back home for target %s", async (next) => {
    getUser.mockResolvedValue(null);
    const html = renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve({ next }) }));
    expect(html).toContain('data-login="/login"');
  });
});
