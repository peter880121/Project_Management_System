import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page";
const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: mocks.user }));

describe("home Agent entry points", () => {
  it("links to implemented workflows", async () => {
    mocks.user.mockResolvedValue({ id: "verified-user", role: "PM" });
    const html = renderToStaticMarkup(await Home());
    expect(html).not.toContain("产品导航");
    expect(html).toContain('href="/projects"');
    expect(html).toContain('href="/audit"');
    expect(html).toContain("ADMIN / QA");
    expect(html).not.toContain("待接入");
    expect(html).toContain("生成合规摘要");
    expect(html).toContain("扫描项目风险");
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
