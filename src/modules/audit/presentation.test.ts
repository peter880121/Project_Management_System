import { describe, it, expect } from "vitest";
import {
  actionLabel,
  auditChanges,
  auditTime,
  displayValue,
} from "./presentation";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AuditEntry } from "@/components/audit/audit-entry";
import { escapeHtml } from "./report";
describe("human readable immutable audit presentation", () => {
  it("distinguishes user activation from project execution status", () => {
    expect(
      auditChanges({
        entityType: "User",
        before: { status: "PENDING" },
        after: { status: "ACTIVE" },
      })[0],
    ).toMatchObject({ before: "待激活", after: "已启用" });
  });
  it("compares nested structures independent of object key order and preserves null/missing distinctions", () => {
    expect(
      auditChanges({
        before: { scope: { a: 1, b: 2 }, status: "TODO" },
        after: { scope: { b: 2, a: 1 }, status: "DONE", assigneeId: null },
      }),
    ).toEqual([
      { key: "status", label: "状态", before: "待开始", after: "已完成" },
      { key: "assigneeId", label: "负责人", before: "未记录", after: "未设置" },
    ]);
  });
  it("uses a fixed timezone, labels current names and never invents historical names", () => {
    expect(auditTime("2026-10-20T09:02:19Z")).toContain("17:02:19");
    expect(auditTime("2026-10-20T09:02:19Z")).toContain("UTC+8");
    expect(displayValue("00000000-0000-4000-8000-000000000002")).toContain(
      "未保存历史名称",
    );
    expect(displayValue("u", { u: "Synthetic member" })).toBe(
      "Synthetic member（当前名称）",
    );
    expect(actionLabel("FUTURE_EVENT")).toContain("其他操作");
  });
  it("renders readable changes and keeps raw evidence in collapsed details", () => {
    const markup = renderToStaticMarkup(
      createElement(AuditEntry, {
        row: {
          id: "a",
          action: "TASK_STATUS_CHANGED",
          createdAt: "2026-10-20T09:00:00Z",
          actor: { name: "Synthetic" },
          before: { status: "TODO" },
          after: { status: "DONE" },
        },
      }),
    );
    expect(markup).toContain("更新任务状态");
    expect(markup).toContain("待开始");
    expect(markup).toContain("已完成");
    expect(markup).toContain("历史角色未记录");
    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details open");
  });
  it("escapes report inputs including scripts and attribute delimiters", () => {
    expect(escapeHtml("<script>\"&'</script>")).toBe(
      "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;",
    );
  });
});
