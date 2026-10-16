import { describe, expect, it } from "vitest";
import { dependencyIds, orderSuggestions, prerequisiteMessage } from "./review-state";

describe("WBS prerequisite review", () => {
  it("orders a reversed dependency chain before its consumers", () => {
    const rows = [
      { id: "test", output: { dependencyIds: ["build"] } },
      { id: "build", output: { dependencyIds: ["design"] } },
      { id: "design", output: {} },
    ];
    expect(orderSuggestions(rows).map(r => r.id)).toEqual(["design", "build", "test"]);
  });
  it("explains pending and rejected dependencies without claiming a removal action exists", () => {
    expect(prerequisiteMessage([{ id: "a", title: "设计", status: "PENDING" }])).toContain("请先采纳前置任务：《设计》");
    expect(prerequisiteMessage([{ id: "a", title: "设计", status: "REJECTED" }])).toContain("重新生成");
    expect(prerequisiteMessage([{ id: "a", title: "设计", status: "ACCEPTED" }])).toBe("");
  });
  it("tolerates malformed stored output and dependency cycles", () => {
    expect(dependencyIds(null)).toEqual([]);
    expect(dependencyIds({ dependencyIds: ["valid", 2, null] })).toEqual(["valid"]);
    const rows = [{ id: "a", output: { dependencyIds: ["b"] } }, { id: "b", output: { dependencyIds: ["a"] } }];
    expect(orderSuggestions(rows)).toHaveLength(2);
  });
});
