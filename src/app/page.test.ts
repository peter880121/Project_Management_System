import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page";
import { ToastProvider } from "@/components/toast-provider";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocks.user }));

describe("home Agent entry points", () => {
  it.each(["ADMIN", "PM", "QA", "MEMBER", "PMO"])("renders the internal chat homepage for %s", async role => {
    mocks.user.mockResolvedValue({ id: "verified-user", role });
    const html = renderToStaticMarkup(createElement(ToastProvider, null, await Home()));
    expect(html).toContain("MedPM 智能助手");
    expect(html).toContain("内部知识优先");
    expect(html).toContain("向智能助手提问");
    expect(html).toContain("发送问题");
    expect(html).toContain("仅使用合成数据");
    expect(html).not.toContain('href="/register"');
  });
  it("renders only the product landing for guests", async () => {
    mocks.user.mockResolvedValue(null);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("产品导航");
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/register"');
    expect(html.match(/<article /g)).toHaveLength(3);
    expect(html).not.toContain('href="/projects"');
    expect(html).not.toContain('href="/audit"');
    expect(html).not.toContain("<button");
  });
  it("does not render a guest landing when session resolution fails", async () => {
    mocks.user.mockRejectedValue(new Error("session unavailable"));
    await expect(Home()).rejects.toThrow("session unavailable");
  });
});
