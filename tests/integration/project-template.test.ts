import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
const failure = vi.hoisted(() => ({ step: "" }));
vi.mock("@/modules/projects/repositories", async importOriginal => {
  const real = await importOriginal<typeof import("@/modules/projects/repositories")>();
  return { ...real,
    insertProjectTasks: async (...args: Parameters<typeof real.insertProjectTasks>) => { const result = await real.insertProjectTasks(...args); if (failure.step === "tasks") throw new Error("injected tasks failure"); return result; },
    insertProjectTaskDependencies: async (...args: Parameters<typeof real.insertProjectTaskDependencies>) => { const result = await real.insertProjectTaskDependencies(...args); if (failure.step === "dependencies") throw new Error("injected dependencies failure"); return result; },
  };
});
vi.mock("@/modules/audit/service", async importOriginal => {
  const real = await importOriginal<typeof import("@/modules/audit/service")>();
  return { ...real, recordAudit: async (...args: Parameters<typeof real.recordAudit>) => { await real.recordAudit(...args); if (failure.step === "audit") throw new Error("injected audit failure"); } };
});
import { prisma } from "@/lib/prisma";
import { createProject } from "@/modules/projects/services";

afterAll(() => prisma.$disconnect());
it.each(["tasks", "dependencies", "audit"])("rolls back actual MySQL writes after %s failure", async step => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(target.hostname) || process.env.NODE_ENV === "production") throw new Error("Local test database required");
  failure.step = step;
  const name = `Synthetic rollback ${randomUUID()}`;
  const before = { tasks: await prisma.task.count(), edges: await prisma.taskDependency.count(), audits: await prisma.auditLog.count() };
  await expect(createProject({ name, description: "Synthetic rollback verification", initializeStandardTasks: true }, { actorId: "00000000-0000-4000-8000-000000000002", ip: "127.0.0.1", userAgent: "project-template-rollback-test" })).rejects.toThrow(`injected ${step} failure`);
  expect(await prisma.project.count({ where: { name } })).toBe(0);
  expect(await prisma.task.count()).toBe(before.tasks);
  expect(await prisma.taskDependency.count()).toBe(before.edges);
  expect(await prisma.auditLog.count()).toBe(before.audits);
});
