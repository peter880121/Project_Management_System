import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const connected = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return connected.client; } }));
import { changeTaskStatus } from "@/modules/audit/service";
import { hashPassword } from "@/modules/auth/password";

// Unique synthetic fixtures preserve existing audit history and never touch real data.
const db = new PrismaClient();
let failAudit = false;
connected.client = db.$extends({ query: { auditLog: { create: async ({ args, query }) => {
  if (failAudit) throw new Error("Synthetic audit outage");
  return query(args);
} } } });
let actorId: string; let taskId: string; let memberId: string;
const password = `Synthetic-${randomUUID()}`;
const sign = () => ({ taskId, actorId, status: "DONE" as const, actualHours: 2, signaturePassword: password, signatureReason: "确认测试通过", ip: "192.0.2.1", userAgent: "Synthetic signature integration" });
describe.sequential("task signatures in real MySQL transactions", () => {
  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL || "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Signature integration requires local MySQL");
    const passwordHash = await hashPassword(password);
    await db.$transaction(async tx => {
      actorId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic signing PM", role: "PM", status: "ACTIVE", passwordHash } })).id;
      memberId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "Synthetic other member", role: "MEMBER", status: "ACTIVE" } })).id;
    });
  });
  beforeEach(async () => {
    failAudit = false;
    await db.$transaction(async tx => {
      const project = await tx.project.create({ data: { name: "Synthetic signature transaction test", ownerId: actorId } });
      await tx.projectMember.create({ data: { projectId: project.id, userId: memberId } });
      taskId = (await tx.task.create({ data: { projectId: project.id, title: "Synthetic signing task", status: "IN_PROGRESS" } })).id;
    });
  });
  afterAll(() => db.$disconnect());
  it("commits status, hours, completion time and safe signature audit together", async () => {
    const result = await changeTaskStatus(sign()); expect(result.status).toBe("DONE"); expect(result.completedAt).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: taskId } });
    expect(audit).toMatchObject({ actorId, action: "TASK_SIGNED_AND_COMPLETED", ip: "192.0.2.1", userAgent: "Synthetic signature integration" });
    expect(audit.after).toMatchObject({ signatureReason: "确认测试通过", status: "DONE" });
    expect(JSON.stringify(audit)).not.toContain(password);
  });
  it("rolls back the task update if audit insertion fails", async () => {
    failAudit = true;
    await expect(changeTaskStatus(sign())).rejects.toThrow("Synthetic audit outage");
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ status: "IN_PROGRESS", actualHours: null, completedAt: null });
    expect(await db.auditLog.count({ where: { entityId: taskId } })).toBe(0);
  });
  it("rejects wrong password before any business write and emits no password", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(changeTaskStatus({ ...sign(), signaturePassword: "Synthetic-wrong" })).rejects.toMatchObject({ status: 401 });
      expect(JSON.stringify(log.mock.calls)).not.toContain("Synthetic-wrong");
      expect(log).toHaveBeenCalledWith("TASK_SIGNATURE_REJECTED", expect.objectContaining({ actorId, taskId }));
    } finally { log.mockRestore(); }
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("IN_PROGRESS");
    expect(await db.auditLog.count({ where: { entityId: taskId } })).toBe(0);
  });
  it("rejects bypassing HTTP validation and unauthorized members", async () => {
    await expect(changeTaskStatus({ ...sign(), signaturePassword: undefined })).rejects.toMatchObject({ status: 400 });
    await expect(changeTaskStatus({ ...sign(), signatureReason: "tampered" })).rejects.toMatchObject({ status: 400 });
    await expect(changeTaskStatus({ ...sign(), actorId: memberId })).rejects.toMatchObject({ status: 403 });
  });
  it("does not require a signature for other transitions", async () => {
    await changeTaskStatus({ taskId, actorId, status: "BLOCKED" });
    expect((await db.auditLog.findFirstOrThrow({ where: { entityId: taskId } })).action).toBe("TASK_STATUS_CHANGED");
  });
  it("serializes competing completion requests to one successful signature", async () => {
    const results = await Promise.allSettled([changeTaskStatus(sign()), changeTaskStatus(sign())]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditLog.count({ where: { entityId: taskId, action: "TASK_SIGNED_AND_COMPLETED" } })).toBe(1);
  });
});
