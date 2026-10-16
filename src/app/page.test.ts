import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page";

describe("home Agent entry points", () => {
  it("links to implemented workflows", async () => {
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('href="/projects"');
    expect(html).toContain('href="/audit"');
    expect(html).toContain("ADMIN / QA");
    expect(html).not.toContain("待接入");
    expect(html).toContain("生成合规摘要");
    expect(html).toContain("扫描项目风险");
  });
});
