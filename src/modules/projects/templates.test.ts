import { expect, it } from "vitest";
import { STANDARD_PROJECT_TASKS } from "./templates";
import { createProjectSchema } from "./schemas";

it("keeps the requested 6-phase, 14-task WBS and a single acyclic chain", () => {
  expect(STANDARD_PROJECT_TASKS.map(task => [task.phase, task.title, task.estimateHours])).toEqual([
    ["项目启动", "召开项目启动会", 4], ["项目启动", "制定实施主计划", 8],
    ["需求与蓝图", "业务需求调研", 40], ["需求与蓝图", "蓝图方案确认", 24],
    ["系统配置", "基础数据与环境准备", 16], ["系统配置", "系统参数与接口联调", 40],
    ["验证与测试", "系统集成测试 SIT", 24], ["验证与测试", "用户验收测试 UAT", 40], ["验证与测试", "CSV 计算机化系统验证", 24],
    ["上线与培训", "历史数据迁移", 32], ["上线与培训", "最终用户培训", 16], ["上线与培训", "系统正式切换上线", 8],
    ["验收与运维", "项目初验", 8], ["验收与运维", "项目终验与移交", 8],
  ]);
  expect(new Set(STANDARD_PROJECT_TASKS.map(task => task.key)).size).toBe(14);
  STANDARD_PROJECT_TASKS.forEach((task, index) => expect(task.dependsOn).toBe(index === 0 ? null : STANDARD_PROJECT_TASKS[index - 1].key));
});
it("defaults template initialization on and requires an explicit boolean to disable it", () => {
  expect(createProjectSchema.parse({ name: "Synthetic" }).initializeStandardTasks).toBe(true);
  expect(createProjectSchema.parse({ name: "Synthetic", initializeStandardTasks: false }).initializeStandardTasks).toBe(false);
  expect(createProjectSchema.safeParse({ name: "Synthetic", initializeStandardTasks: "false" }).success).toBe(false);
});
