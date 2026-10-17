import { expect, it } from "vitest";
import { canRefineTask, canCheckTaskEvidence } from "./task-actions";
it("matches simple keywords and reflects renamed titles", () => {
  expect(canRefineTask("蓝图方案确认")).toBe(true);
  expect(canRefineTask("业务需求调研")).toBe(true);
  expect(canRefineTask("召开项目启动会")).toBe(false);
  for (const title of ["用户验收测试 UAT", "uat", "csv 验证", "系统集成测试 SIT"]) expect(canCheckTaskEvidence(title)).toBe(true);
  expect(canCheckTaskEvidence("最终用户培训")).toBe(false);
});
