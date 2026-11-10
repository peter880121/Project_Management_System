import { describe, it, expect } from "vitest";
import { projectMaintenanceSchema } from "./maintenance-schema";
import { taskDetailsSchema } from "@/modules/tasks/details-schema";
import { taskDescription } from "@/modules/tasks/plan";
describe("audited project and task maintenance inputs", () => {
  it("requires versions and rejects mixed owner/details writes", () => {
    expect(projectMaintenanceSchema.safeParse({ operation: "details", name: "project", description: "" }).success).toBe(false);
    expect(projectMaintenanceSchema.safeParse({ operation: "details", expectedRowVersion: 1, name: "project", description: "", ownerId: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);
    expect(projectMaintenanceSchema.parse({ operation: "details", expectedRowVersion: 1, name: " project ", description: " text " })).toMatchObject({ name: "project", description: "text" });
  });
  it("requires a bounded handoff reason and explicit project name", () => {
    const input = { operation: "transfer", expectedRowVersion: 1, ownerId: "00000000-0000-4000-8000-000000000001", confirmationName: "project", reason: "handoff with evidence" };
    expect(projectMaintenanceSchema.safeParse(input).success).toBe(true);
    for (const reason of [" ", "short", "x".repeat(1001)]) expect(projectMaintenanceSchema.safeParse({ ...input, reason }).success).toBe(false);
  });
  it("rejects blank titles, invalid phases and mass-assignment of status", () => {
    const input = { operation: "details", expectedRowVersion: 1, title: "task", description: "", phase: "项目启动" };
    expect(taskDetailsSchema.safeParse(input).success).toBe(true);
    for (const patch of [{ title: " " }, { phase: "a\nb" }, { status: "DONE" }, { expectedRowVersion: 0 }]) expect(taskDetailsSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it("keeps exactly one canonical phase marker when editing descriptions", () => {
    expect(taskDescription("自定义阶段", "所属阶段：旧阶段\n说明\n所属阶段: 注入阶段")).toBe("所属阶段：自定义阶段\n说明");
  });
});
