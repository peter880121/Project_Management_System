import { expect, test } from "@playwright/test";
import { createSessionToken } from "../src/modules/auth/session-token";
const projectId = "00000000-0000-4000-8000-000000000065";
test.use({ trace: "off" });
test("project sections share a real back button with consistent appearance and no heading overlap", async ({ page, context, baseURL }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 1440, height: 1000 });
  await context.addCookies([{ name: "medpm_session", value: createSessionToken("00000000-0000-4000-8000-000000000002", Date.now() + 3600000), url: baseURL!, httpOnly: true }]);
  let baseline: unknown;
  for (const segment of ["planning", "deliverables", "meetings", "members", "documents", "traceability", "wbs", "risks", "settings", "acceptance", "tasks/new", "exports"]) {
    if (segment === "exports") await context.addCookies([{ name: "medpm_session", value: createSessionToken("00000000-0000-4000-8000-000000000001", Date.now() + 3600000), url: baseURL!, httpOnly: true }]);
    await page.goto(`/projects/${projectId}/${segment}`);
    const back = page.locator("main [data-page-back=true]").first(); await expect(back).toHaveText("返回任务看板"); await expect(back).toHaveAttribute("href", `/projects/${projectId}/board`);
    const box = (await back.boundingBox())!; const heading = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40); expect(heading.y).toBeGreaterThanOrEqual(box.y + box.height + 8);
    const style = await back.evaluate(element => { const css = getComputedStyle(element); return { height: css.height, radius: css.borderRadius, background: css.backgroundColor, color: css.color, padding: css.padding, border: css.borderColor }; });
    if (!baseline) baseline = style; else expect(style).toEqual(baseline);
    if (segment === "deliverables" && process.env.E2E_CAPTURE_GANTT_FIX === "1") await page.screenshot({ path: "test-results/deliverables-actions-fixed.png" });
  }
});
