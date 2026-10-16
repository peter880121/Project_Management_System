import { describe, expect, it } from "vitest";
import { csvCell, traceabilityCsv } from "./report";
describe("traceability CSV", () => {
  it("escapes formulas, quotes and multiline content for spreadsheet clients", () => {
    for (const value of ["=1+1", " +cmd", "@SUM(1)", "-1", "\ttext", "\ntext"]) expect(csvCell(value)).toMatch(/^"'/);
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("retains missing task/test links and unlinked tasks", () => {
    const csv = traceabilityCsv({ exportId: "export", generatedAt: "UTC" }, [{ id: "requirement", title: "缺少任务与测试", status: "APPROVED", version: 2 }], [{ id: "task", title: "孤立任务", requirementId: null, status: "TODO", reviewedRequirementVersion: null }], []).toString("utf8");
    expect(csv.startsWith("\uFEFF")).toBe(true); expect(csv).toContain("缺少任务与测试"); expect(csv).toContain("孤立任务"); expect(csv.split("\r\n")).toHaveLength(4);
  });
  it("caps combinatorial task/test expansion", () => {
    const tasks = Array.from({ length: 150 }, (_, i) => ({ id: `t${i}`, title: "Synthetic", requirementId: "r", status: "TODO", reviewedRequirementVersion: null }));
    const tests = tasks.map((t) => ({ ...t, requirementId: "r" }));
    expect(() => traceabilityCsv({ exportId: "e", generatedAt: "UTC" }, [{ id: "r", title: "Synthetic", status: "DRAFT", version: 1 }], tasks, tests)).toThrow("EXPORT_ROW_LIMIT");
  });
});
