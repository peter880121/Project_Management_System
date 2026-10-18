import { expect, it } from "vitest";
import { groupTasksByPhase, taskPhase } from "./task-phases";

it("parses phase lines with whitespace and either colon, without treating prose as metadata", () => {
  expect(taskPhase("说明\r\n 所属阶段 : 需求与蓝图 \r\n其他内容")).toBe("需求与蓝图");
  expect(taskPhase("所属阶段：项目启动")).toBe("项目启动");
  expect(taskPhase("说明中提到所属阶段：项目启动")).toBeNull();
  expect(taskPhase("所属阶段：\n说明")).toBeNull();
  expect(taskPhase(null)).toBeNull();
});
it("orders standard phases, retains custom phases and task order, and puts ungrouped last", () => {
  const tasks = [
    { id: 1, description: null }, { id: 2, description: "所属阶段：验证与测试" },
    { id: 3, description: "所属阶段：自定义" }, { id: 4, description: "所属阶段：项目启动" },
    { id: 5, description: "所属阶段：项目启动" },
  ];
  const groups = groupTasksByPhase(tasks);
  expect(groups.map(group => group.phase)).toEqual(["项目启动", "验证与测试", "自定义", "未分组"]);
  expect(groups[0].tasks.map(task => task.id)).toEqual([4, 5]);
  expect(tasks[0].id).toBe(1);
});
