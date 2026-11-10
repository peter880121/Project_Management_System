import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient, type Requirement } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, auditFails: false }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
import { createRequirement, editRequirement, actOnRequirement, createIntake, triageIntake, createBaseline } from "@/modules/requirements/services";
import { uploadRequirementImage, readRequirementImage } from "@/modules/requirements/images";
import { requirementAcceptance } from "@/modules/requirements/acceptance";
import { acceptanceEvidence } from "@/modules/projects/acceptance";
import { saveTraceability } from "@/modules/projects/services";
import { hashPassword } from "@/modules/auth/password";
import { changeProjectLifecycle } from "@/modules/projects/lifecycle";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (state.auditFails && String(args.data.action).startsWith("REQUIREMENT_")) throw new Error("Synthetic audit outage"); return query(args); } } } });
const password = "Synthetic-test-only-29!";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+ZkAAAAASUVORK5CYII=", "base64");
const objects = new Map<string, Buffer>();
const storage = { put: vi.fn(async (key: string, bytes: Buffer) => { objects.set(key, bytes); }), get: vi.fn(async (key: string) => objects.get(key)!), remove: vi.fn(async (key: string) => { objects.delete(key); }) };
let pm: string, qa: string, admin: string, member: string, outsider: string, projectId: string;
const fields = () => ({ title: `Synthetic requirement ${randomUUID()}`, content: "Synthetic workflow content", acceptanceCriteria: "Verify the expected synthetic response", dueDate: "2026-10-31", ownerId: pm, priority: "MUST", category: "FUNCTIONAL", riskLevel: "NORMAL", discoveryPhase: "Validation", targetRelease: "V1" });
const actor = (actorId = pm) => ({ actorId });
async function create() { return createRequirement(projectId, { ...fields(), requestKey: randomUUID() }, actor()); }
async function action(row: Requirement, op: Parameters<typeof actOnRequirement>[2], extra = {}, actorId = pm) { return actOnRequirement(projectId, row.id, op, { requestKey: randomUUID(), expectedRowVersion: row.rowVersion, comment: "Synthetic reviewed and documented decision", ...extra }, actor(actorId)); }
async function approve(row: Requirement) { return action(await action(row, "submit"), "approve", { signaturePassword: password }, qa); }
async function evidenceDocument() { return db.$transaction(tx => tx.document.create({ data: { projectId, filename: "synthetic-evidence.pdf", minioKey: `synthetic/${randomUUID()}`, mediaType: "application/pdf", sha256: "a".repeat(64), fileSize: 10, storageStatus: "AVAILABLE", uploadedById: pm } })); }
async function verified(row: Requirement) {
  row = await approve(row); row = await action(row, "start");
  await db.$transaction(tx => tx.task.create({ data: { projectId, title: "Synthetic done implementation", requirementId: row.id, status: "DONE", completedAt: new Date("2026-10-20T00:00:00.000Z"), actualHours: 1, estimateHours: 1, dueDate: new Date("2026-10-31T00:00:00.000Z"), plannedStartDate: new Date("2026-10-20T00:00:00.000Z") } }));
  const test = await db.$transaction(tx => tx.testCase.create({ data: { requirementId: row.id, title: "Synthetic acceptance test" } }));
  row = await action(row, "verify"); const doc = await evidenceDocument();
  row = await action(row, "record-test", { testCaseId: test.id, result: "PASSED", documentId: doc.id }, qa);
  row = await action(row, "confirm-verification", {}, qa);
  row = await action(row, "customer-confirm", { documentId: doc.id });
  return { row, test, doc };
}
describe.sequential("requirements lifecycle with real MySQL transactions", () => {
  beforeAll(async () => {
    if (!/^medpm_test_ia_/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1))) throw new Error("Isolated database required");
    // Rollback before evidence exists, then replay twice to prove migration safety.
    if (!await db.requirement.count({ where: { managed: true } }) && !await db.requirementTaskLink.count() && !await db.requirementIntake.count() && !await db.requirementBaseline.count()) {
      for (const file of ["rollback.sql", "migration.sql", "migration.sql"]) execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", `prisma/migrations/20261029000000_requirements_management/${file}`, "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true });
    }
    const hash = await hashPassword(password);
    [pm, qa, admin, member, outsider] = await db.$transaction(async tx => { const ids: string[] = []; for (const role of ["PM", "QA", "ADMIN", "MEMBER", "PM"] as const) ids.push((await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: `Synthetic ${role}`, role, status: "ACTIVE", passwordHash: hash } })).id); return ids; });
  });
  beforeEach(async () => { state.auditFails = false; vi.clearAllMocks(); projectId = await db.$transaction(async tx => { const p = await tx.project.create({ data: { name: "Synthetic requirements project", status: "ACTIVE", ownerId: pm } }); await tx.projectMember.createMany({ data: [qa, member].map(userId => ({ projectId: p.id, userId })) }); return p.id; }); });
  afterAll(() => db.$disconnect());
  it("numbers concurrently, encodes planned dates explicitly in UTC and rejects stale edits", async () => {
    const rows = await Promise.all([create(), create()]); expect(rows.map(r => r.number).sort()).toEqual(["REQ-0001", "REQ-0002"]); expect(rows[0].dueDate?.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    const old = rows[0]; await editRequirement(projectId, old.id, { ...fields(), expectedRowVersion: 1 }, actor()); await expect(editRequirement(projectId, old.id, { ...fields(), expectedRowVersion: 1 }, actor())).rejects.toMatchObject({ status: 409 });
    expect(await db.requirementRevision.count({ where: { requirementId: old.id } })).toBe(2);
  });
  it("retains original intake and image provenance when converting to a formal requirement", async () => {
    const intake = await createIntake(projectId, { title: "Synthetic customer feedback", content: "Synthetic detail", requester: "Synthetic contact", source: "CUSTOMER", requestKey: randomUUID() }, actor(member));
    const image = await uploadRequirementImage(projectId, { intakeId: intake.id }, { filename: "workflow.png", bytes: png, expectedRowVersion: 1 }, actor(member), storage);
    const row = await createRequirement(projectId, { ...fields(), intakeId: intake.id, requestKey: randomUUID() }, actor());
    expect(await db.requirementIntake.findUniqueOrThrow({ where: { id: intake.id } })).toMatchObject({ state: "CONVERTED", requirementId: row.id });
    expect((await readRequirementImage(projectId, image.id, actor(qa), storage)).bytes).toEqual(png);
    await expect(triageIntake(projectId, intake.id, { expectedRowVersion: 2, state: "REJECTED", reason: "Synthetic rejection reason" }, actor())).rejects.toMatchObject({ status: 409 });
  });
  it("does not let old traceability API bypass required dates or edit managed revisions", async () => {
    await expect(saveTraceability(projectId, { kind: "requirement", title: "Bypass", content: "Synthetic", status: "APPROVED" }, actor())).rejects.toMatchObject({ status: 409 });
    const row = await create(); await expect(saveTraceability(projectId, { kind: "requirement", id: row.id, expectedVersion: 1, title: row.title, content: "Tamper", status: "APPROVED" }, actor())).rejects.toMatchObject({ status: 409 });
  });
  it("revalidates role/scope, rejects self approval and rolls back wrong-password attempts", async () => {
    const row = await create(); const submitted = await action(row, "submit");
    for (const id of [pm, member, outsider]) await expect(action(submitted, "approve", { signaturePassword: password }, id)).rejects.toMatchObject({ status: 403 });
    await db.$transaction(tx => tx.user.update({ where: { id: pm }, data: { role: "ADMIN" } }));
    try { await expect(action(submitted, "approve", { signaturePassword: password })).rejects.toMatchObject({ status: 403 }); } finally { await db.$transaction(tx => tx.user.update({ where: { id: pm }, data: { role: "PM" } })); }
    await expect(action(submitted, "approve", { signaturePassword: "wrong-password" }, qa)).rejects.toMatchObject({ status: 401 });
    expect((await db.requirement.findUniqueOrThrow({ where: { id: row.id } })).workflowState).toBe("IN_REVIEW");
    expect(await db.requirementDecision.count({ where: { requirementId: row.id, action: "APPROVE" } })).toBe(0);
  });
  it("locks images at review, protects revision bytes at DB level and never exposes storage keys", async () => {
    let row = await create(); const image = await uploadRequirementImage(projectId, { requirementId: row.id }, { filename: "screen.png", bytes: png, expectedRowVersion: 1 }, actor(), storage); expect(image).not.toHaveProperty("minioKey");
    row = await db.requirement.findUniqueOrThrow({ where: { id: row.id } }); row = await action(row, "submit");
    await expect(uploadRequirementImage(projectId, { requirementId: row.id }, { filename: "late.png", bytes: png, expectedRowVersion: row.rowVersion }, actor(), storage)).rejects.toMatchObject({ status: 409 });
    await expect(db.$executeRaw`UPDATE RequirementRevision SET content='tampered' WHERE requirementId=${row.id}`).rejects.toThrow("ER_REQUIREMENT_EVIDENCE_IMMUTABLE");
    await expect(readRequirementImage(projectId, image.id, actor(outsider), storage)).rejects.toMatchObject({ status: 403 });
    await expect(db.$executeRaw`DELETE FROM RequirementAttachment WHERE id=${image.id}`).rejects.toThrow("ER_REQUIREMENT_EVIDENCE_IMMUTABLE");
  });
  it("rolls back database writes on audit failure and compensates image storage", async () => {
    state.auditFails = true; await expect(create()).rejects.toThrow("Synthetic audit outage"); expect(await db.requirement.count({ where: { projectId } })).toBe(0);
    state.auditFails = false; const row = await create(); state.auditFails = true;
    await expect(uploadRequirementImage(projectId, { requirementId: row.id }, { filename: "screen.png", bytes: png, expectedRowVersion: row.rowVersion }, actor(), storage)).rejects.toMatchObject({ status: 503 });
    expect(await db.requirementAttachment.count({ where: { projectId } })).toBe(0); expect(storage.remove).toHaveBeenCalled();
    expect((await db.requirement.findUniqueOrThrow({ where: { id: row.id } })).rowVersion).toBe(1);
  });
  it("isolates business versions and invalidates old test results after an approved change", async () => {
    const { row: verifiedRow, test, doc } = await verified(await create()); let row = verifiedRow;
    row = await action(row, "change", { impact: { scope: "New field", schedule: "One day", cost: "One day effort", risk: "Regression needed" } });
    const edited = { ...fields(), title: row.title, dueDate: "2026-11-15", expectedRowVersion: row.rowVersion }; row = await editRequirement(projectId, row.id, edited, actor()); expect(row.version).toBe(1); expect(row.dueDate?.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    row = await approve(row); expect(row.version).toBeGreaterThan(1); expect(row.dueDate?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    row = await action(row, "start"); row = await action(row, "verify"); await expect(action(row, "confirm-verification", {}, qa)).rejects.toMatchObject({ status: 400 });
    row = await action(row, "record-test", { testCaseId: test.id, result: "PASSED", documentId: doc.id }, qa); await action(row, "confirm-verification", {}, qa);
    expect(await db.testExecution.count({ where: { requirementId: row.id } })).toBe(2);
  });
  it("requires customer evidence and actual date before closing, and pins it in the acceptance snapshot", async () => {
    let { row } = await verified(await create());
    await expect(action(row, "close")).rejects.toMatchObject({ status: 400 });
    row = await action(row, "close", { completedAt: "2026-10-20" }); expect(row.completedAt?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    const baseline = await createBaseline(projectId, { name: "Synthetic V1 baseline", requirementIds: [row.id] }, actor());
    const readiness = await db.$transaction(tx => requirementAcceptance(tx, projectId)); expect(readiness.gapCount).toBe(0); expect(readiness.baseline?.id).toBe(baseline.id);
    const snapshot = await db.$transaction(tx => acceptanceEvidence(tx, projectId, 5)); expect(snapshot.requirements?.requirements[0].completedAt).toBe("2026-10-20T00:00:00.000Z");
    await expect(db.$executeRaw`UPDATE TestExecution SET result='FAILED' WHERE requirementId=${row.id}`).rejects.toThrow("ER_REQUIREMENT_EVIDENCE_IMMUTABLE");
  });
  it("detects changes to test definitions and reopened implementation tasks", async () => {
    const { row, test } = await verified(await create()); await db.$transaction(tx => tx.testCase.update({ where: { id: test.id }, data: { title: "Updated synthetic test definition" } }));
    await expect(action(row, "close", { completedAt: "2026-10-20" })).rejects.toMatchObject({ status: 400 });
  });
  it("requires independent signed cancellation for approved requirements and makes cancellation terminal", async () => {
    let row = await approve(await create()); row = await action(row, "cancel"); expect(row.workflowState).toBe("CANCEL_REVIEW");
    await expect(action(row, "start")).rejects.toMatchObject({ status: 409 });
    row = await action(row, "approve-cancel", { signaturePassword: password }, qa); expect(row.workflowState).toBe("CANCELLED");
    await expect(action(row, "change", { impact: { scope: "x", schedule: "x", cost: "x", risk: "x" } })).rejects.toMatchObject({ status: 409 });
  });
  it("supports many-to-many task links without overwriting the primary legacy trace", async () => {
    let first = await create(); let second = await create(); const task = await db.$transaction(tx => tx.task.create({ data: { projectId, title: "Synthetic shared task" } }));
    first = await action(first, "link-task", { taskId: task.id }); second = await action(second, "link-task", { taskId: task.id });
    expect(await db.requirementTaskLink.count({ where: { taskId: task.id } })).toBe(2); expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).requirementId).toBe(first.id);
    const other = await db.$transaction(tx => tx.project.create({ data: { name: "Synthetic other project", ownerId: pm, status: "ACTIVE" } }));
    await expect(actOnRequirement(other.id, second.id, "start", { requestKey: randomUUID(), expectedRowVersion: second.rowVersion }, actor())).rejects.toMatchObject({ status: 404 });
  });
  it.each(["ON_HOLD", "CANCELLED", "ARCHIVED"])("reuses HTTP/transaction/DB freeze for %s", async status => {
    const row = await create();
    if (status === "ON_HOLD") await changeProjectLifecycle(projectId, "pause", { expectedRowVersion: 1, requestKey: randomUUID(), reason: "Synthetic requirements freeze test" }, actor());
    else if (status === "CANCELLED") await changeProjectLifecycle(projectId, "cancel", { expectedRowVersion: 1, requestKey: randomUUID(), reason: "Synthetic requirements cancellation test", confirmationName: "Synthetic requirements project" }, actor());
    else await db.$transaction(tx => tx.project.update({ where: { id: projectId }, data: { status: "ARCHIVED" } }));
    await expect(editRequirement(projectId, row.id, { ...fields(), expectedRowVersion: row.rowVersion }, actor())).rejects.toMatchObject({ projectStatus: status });
    await expect(db.$executeRaw`INSERT INTO RequirementBaseline(id,projectId,name,ordinal,entries,sha256,createdById) VALUES(${randomUUID()},${projectId},'tampered',1,'[]',${"a".repeat(64)},${pm})`).rejects.toThrow(status === "ARCHIVED" ? "ER_ARCHIVED_PROJECT" : "ER_PROJECT_FROZEN");
  });
  it("does not let an empty baseline bypass unmet commitments or destructive rollback erase evidence", async () => {
    const row = await approve(await create()); expect((await db.$transaction(tx => requirementAcceptance(tx, projectId))).gapCount).toBe(1);
    await createBaseline(projectId, { name: "Synthetic pending scope", requirementIds: [row.id] }, actor());
    expect((await db.$transaction(tx => requirementAcceptance(tx, projectId))).gapCount).toBe(1);
    expect(() => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/migrations/20261029000000_requirements_management/rollback.sql", "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", windowsHide: true })).toThrow();
  });
  it("cannot hide approved commitments by omitting them from a newer baseline", async () => {
    const first = await approve(await create()); await createBaseline(projectId, { name: "Synthetic first scope", requirementIds: [first.id] }, actor());
    const second = await approve(await create());
    const current = await db.$transaction(tx => requirementAcceptance(tx, projectId)); expect(current.gapCount).toBe(2); expect(current.requirements.find(r => r.requirementId === second.id)?.passed).toBe(false);
    await expect(createBaseline(projectId, { name: "Omitted scope", requirementIds: [first.id] }, actor())).rejects.toMatchObject({ status: 400 });
    const next = await createBaseline(projectId, { name: "Synthetic complete scope", requirementIds: [first.id, second.id] }, actor()); expect(next.ordinal).toBe(2);
  });
});
