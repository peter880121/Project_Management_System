import { expect, it } from "vitest";
import { canUpdateTask, orderBoardTasks, taskPhase, taskStatusOptions, type BoardTask } from "./board-types";
it("extracts the stored phase without assigning a phase to ordinary descriptions", () => {
  expect(taskPhase("所属阶段：验证与测试\n合成软件测试说明")).toBe("验证与测试");
  expect(taskPhase("普通任务说明")).toBeNull();
  expect(taskPhase(null)).toBeNull();
});
it("shows standard WBS tasks in phase order without mutating the fetched list", () => {
  const base: BoardTask = { id: "task", title: "项目终验与移交", description: "所属阶段：验收与运维", status: "TODO", assigneeId: null, assignee: null, requirement: null };
  const list = [base, { ...base, id: "kickoff", title: "召开项目启动会", description: "所属阶段：项目启动" }];
  expect(orderBoardTasks(list).map(task => task.id)).toEqual(["kickoff", "task"]);
  expect(list[0]).toBe(base);
});
it("preserves member ownership and completed-task restrictions in UI controls", () => {
  const task: BoardTask = { id: "task", title: "Synthetic", description: null, status: "DONE", assigneeId: "member", assignee: null, requirement: null };
  expect(canUpdateTask(task, "MEMBER", "other")).toBe(false);
  expect(canUpdateTask(task, "QA", "member")).toBe(false);
  expect(canUpdateTask(task, "MEMBER", "member")).toBe(true);
  expect(taskStatusOptions("DONE", "MEMBER")).toEqual([]);
  expect(taskStatusOptions("DONE", "PM")).toEqual(["IN_PROGRESS", "TODO"]);
});
