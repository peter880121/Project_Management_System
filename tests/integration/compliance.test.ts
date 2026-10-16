import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const connected = vi.hoisted(() => ({ client: undefined as unknown as import("@prisma/client").PrismaClient }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return connected.client; } }));
vi.mock("@/modules/ai/chat-model", () => ({ getConfiguredLlm: () => { throw new Error("Synthetic model unavailable"); } }));
import { runComplianceAudit } from "@/modules/ai/compliance-audit/service";
import { reviewFinding, reviewRequirementVersion, reviewSummary } from "@/modules/ai/compliance-audit/review-service";
import { saveTraceability } from "@/modules/projects/services";

if (!process.env.DATABASE_URL || !process.env.MYSQL_ROOT_PASSWORD) throw new Error("Compliance integration requires local MySQL credentials");
const source = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Only local MySQL is allowed");
const name = `medpm_compliance_it_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
const testUrl = new URL(source); testUrl.pathname = `/${name}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
connected.client = db;
const qaId = randomUUID(); const pmId = randomUUID();
let taskUpdatedAt: string; let caseUpdatedAt: string;
let projectId: string; let requirementId: string; let taskId: string; let caseId: string;
const actor = { actorId: qaId, ip: "192.0.2.61", userAgent: "synthetic-compliance-integration" };
function sql(input: string) { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, input, stdio: "pipe" }); }
describe.sequential("compliance review with real isolated MySQL", () => {
  beforeAll(async () => {
    if (!/^medpm_compliance_it_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid isolated database name");
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });
    await db.$transaction(async (tx) => {
      await tx.user.create({ data: { id: qaId, name: "Synthetic QA", email: `${qaId}@medpm.local`, role: "QA", status: "ACTIVE" } });
      await tx.user.create({ data: { id: pmId, name: "Synthetic PM", email: `${pmId}@medpm.local`, role: "PM", status: "ACTIVE" } });
    });
  }, 60000);
  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const project = await tx.project.create({ data: { name: "Synthetic compliance" } }); projectId = project.id;
      await tx.projectMember.createMany({ data: [qaId, pmId].map((userId) => ({ projectId, userId })) });
      const requirement = await tx.requirement.create({ data: { projectId, title: "Synthetic requirement", content: "Synthetic criteria", status: "APPROVED" } }); requirementId = requirement.id;
      const task = await tx.task.create({ data: { projectId, title: "Synthetic task", requirementId } }); taskId = task.id; taskUpdatedAt = task.updatedAt.toISOString();
      const testCase = await tx.testCase.create({ data: { requirementId, title: "Synthetic test", status: "PASSED" } }); caseId = testCase.id; caseUpdatedAt = testCase.updatedAt.toISOString();
      await tx.auditLog.create({ data: { actorId: qaId, projectId, action: "TASK_CREATED", entityType: "Task", entityId: taskId } });
    });
  });
  afterAll(async () => {
    await db.$disconnect();
    try { if (/^medpm_compliance_it_[a-f0-9]{32}$/.test(name)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``); }
    finally { await admin.$disconnect(); }
  });
  it("persists fallback snapshot as pending and allows one immutable finding review and one summary decision", async () => {
    const result = await runComplianceAudit({ projectId, ...actor });
    expect(result.degraded).toBe(true); expect(result.status).toBe("PENDING"); expect(result.findings).toHaveLength(2);
    expect(result.coverage.complete).toBe(true);
    const key = result.findings[0]!.findingKey;
    await reviewFinding(result.summaryId, key, { decision: "CONFIRMED", note: "Synthetic gap confirmed" }, actor);
    await expect(reviewFinding(result.summaryId, key, { decision: "DISMISSED", note: "Duplicate" }, actor)).rejects.toMatchObject({ code: "P2002" });
    await reviewSummary(result.summaryId, { decision: "ACCEPTED", note: "Reviewed synthetic snapshot" }, actor);
    await expect(reviewSummary(result.summaryId, { decision: "REJECTED", note: "Duplicate" }, actor)).rejects.toMatchObject({ status: 409 });
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("TODO");
    expect(await db.auditLog.count({ where: { projectId, action: "AI_SUGGESTION_ACCEPTED" } })).toBe(1);
  });
  it("tracks current requirement version, invalidates edits, and rejects stale version confirmation", async () => {
    for (const [entityType, entityId] of [["Task", taskId], ["TestCase", caseId]] as const) await reviewRequirementVersion(projectId, { entityType, entityId, expectedRequirementId: requirementId, expectedRequirementVersion: 1, expectedUpdatedAt: entityType === "Task" ? taskUpdatedAt : caseUpdatedAt, note: "Verified synthetic alignment" }, actor);
    expect((await runComplianceAudit({ projectId, ...actor })).findings).toHaveLength(0);
    await saveTraceability(projectId, { kind: "requirement", id: requirementId, title: "Synthetic requirement", content: "Changed synthetic criteria", status: "APPROVED", expectedVersion: 1 }, { actorId: pmId });
    await expect(reviewRequirementVersion(projectId, { entityType: "Task", entityId: taskId, expectedRequirementId: requirementId, expectedRequirementVersion: 1, expectedUpdatedAt: taskUpdatedAt, note: "Stale" }, actor)).rejects.toMatchObject({ status: 409 });
    expect((await runComplianceAudit({ projectId, ...actor })).findings).toHaveLength(2);
    await saveTraceability(projectId, { kind: "task", id: taskId, requirementId: null, expectedRequirementId: requirementId }, { actorId: pmId });
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).reviewedRequirementVersion).toBeNull();
    const row = await db.testCase.findUniqueOrThrow({ where: { id: caseId } });
    await saveTraceability(projectId, { kind: "testCase", id: caseId, title: "Renamed synthetic test", status: "PASSED", expectedUpdatedAt: row.updatedAt.toISOString() }, actor);
    expect((await db.testCase.findUniqueOrThrow({ where: { id: caseId } })).reviewedRequirementVersion).toBeNull();
  });
  it("rejects PM and cross-project QA reviews; competing decisions commit once", async () => {
    const input = { entityType: "Task" as const, entityId: taskId, expectedRequirementId: requirementId, expectedRequirementVersion: 1, expectedUpdatedAt: taskUpdatedAt, note: "Synthetic review" };
    await expect(reviewRequirementVersion(projectId, input, { actorId: pmId })).rejects.toMatchObject({ status: 403 });
    await expect(reviewRequirementVersion(randomUUID(), input, actor)).rejects.toMatchObject({ status: 404 });
    const result = await runComplianceAudit({ projectId, ...actor });
    const decisions = await Promise.allSettled([reviewSummary(result.summaryId, { decision: "ACCEPTED", note: "A" }, actor), reviewSummary(result.summaryId, { decision: "REJECTED", note: "B" }, actor)]);
    expect(decisions.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditLog.count({ where: { entityId: result.summaryId, action: { in: ["AI_SUGGESTION_ACCEPTED", "AI_SUGGESTION_REJECTED"] } } })).toBe(1);
  });
  it("rejects review from a stale page after entity content changed", async () => {
    const row = await db.testCase.findUniqueOrThrow({ where: { id: caseId } });
    await saveTraceability(projectId, { kind: "testCase", id: caseId, title: "Changed synthetic content", status: "PASSED", expectedUpdatedAt: row.updatedAt.toISOString() }, actor);
    await expect(reviewRequirementVersion(projectId, { entityType: "TestCase", entityId: caseId, expectedRequirementId: requirementId, expectedRequirementVersion: 1, expectedUpdatedAt: row.updatedAt.toISOString(), note: "Old page" }, actor)).rejects.toMatchObject({ status: 409 });
    expect((await db.testCase.findUniqueOrThrow({ where: { id: caseId } })).reviewedRequirementVersion).toBeNull();
  });
  it("rolls back new summaries, finding decisions and version reviews when audit insertion fails", async () => {
    const summary = await runComplianceAudit({ projectId, ...actor });
    const before = await db.aiSuggestion.count();
    sql("CREATE TRIGGER compliance_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure';");
    try {
      await expect(runComplianceAudit({ projectId, ...actor })).rejects.toThrow(); expect(await db.aiSuggestion.count()).toBe(before);
      await expect(reviewSummary(summary.summaryId, { decision: "ACCEPTED", note: "Synthetic" }, actor)).rejects.toThrow();
      expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: summary.summaryId } })).status).toBe("PENDING");
      await expect(reviewFinding(summary.summaryId, summary.findings[0]!.findingKey, { decision: "CONFIRMED", note: "Synthetic" }, actor)).rejects.toThrow();
      expect(await db.complianceFindingReview.count({ where: { suggestionId: summary.summaryId } })).toBe(0);
      await expect(reviewRequirementVersion(projectId, { entityType: "Task", entityId: taskId, expectedRequirementId: requirementId, expectedRequirementVersion: 1, expectedUpdatedAt: taskUpdatedAt, note: "Synthetic" }, actor)).rejects.toThrow();
      expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).reviewedRequirementVersion).toBeNull();
    } finally { sql("DROP TRIGGER compliance_it_fail_audit;"); }
  });
  it("supports structural rollback without deleting audit evidence", async () => {
    const count = await db.auditLog.count();
    const directory = "prisma/migrations/20261015000000_compliance_review/";
    sql(readFileSync(directory + "down.sql", "utf8"));
    expect(await db.auditLog.count()).toBe(count);
    const columns = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'Task' AND column_name = 'reviewedRequirementVersion'`;
    expect(Number(columns[0]!.n)).toBe(0);
    sql(readFileSync(directory + "migration.sql", "utf8"));
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).reviewedRequirementVersion).toBeNull();
  });
});
