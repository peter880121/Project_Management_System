import "dotenv/config";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, failAudit: false, failNotification: false }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
import { transitionProject, snapshotHash } from "@/modules/projects/acceptance";
import { exportClosureReport } from "@/modules/projects/closure-report";
import { freezeErrorResponse } from "@/modules/projects/freeze";
import { FROZEN_PROJECT_TABLES } from "@/modules/projects/freeze-manifest";
import { changeTaskStatus } from "@/modules/audit/service";
import { syncAssetSourceTick } from "@/modules/assets/source-worker";
import { buildDocumentChunksTick, syncDocumentVectorTick } from "@/modules/documents/rag-worker";
import { artifactWork } from "@/modules/documents/parse-repositories";
const source = new URL(process.env.DATABASE_URL!); const name = `medpm_closure_it_${randomUUID().replaceAll("-", "")}`;
const target = new URL(source); target.pathname = `/${name}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD!; adminUrl.pathname = "/mysql";
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } }); const db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (state.failAudit) throw new Error("Synthetic archive audit outage"); return query(args); } }, projectNotification: { createMany: async ({ args, query }) => { if (state.failNotification) throw new Error("Synthetic notification outage"); return query(args); } } } });
let projectId: string, pmId: string, qaId: string, adminId: string, memberId: string, taskId: string, documentId: string, deliverableId: string, meetingId: string;
const body = (version: number, acceptanceId?: string) => ({ expectedRowVersion: version, requestKey: randomUUID(), acceptanceId, comment: "Synthetic closure review" });
async function submitAndQa() { await transitionProject(projectId, "submit-acceptance", body(1), { actorId: pmId }); const p = await db.project.findUniqueOrThrow({ where: { id: projectId } }); await transitionProject(projectId, "qa-approve", body(2, p.currentAcceptanceId!), { actorId: qaId }); return p.currentAcceptanceId!; }
async function archive() { const id = await submitAndQa(); await transitionProject(projectId, "archive", body(3, id), { actorId: adminId }); return id; }
async function denied(operation: () => Promise<unknown>) { try { await operation(); throw new Error("Archive SQL write unexpectedly succeeded"); } catch (error) { const response = freezeErrorResponse(error); expect(response?.status).toBe(403); expect(await response!.json()).toMatchObject({ code: "PROJECT_ARCHIVED" }); } }
describe.sequential("acceptance and physical archive guards in isolated real MySQL", () => {
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname) || !/^medpm_closure_it_[a-f0-9]{32}$/.test(name)) throw new Error("Isolated local synthetic DB required");
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: target.toString() }, stdio: "pipe" });
  }, 60000);
  beforeEach(async () => {
    state.failAudit = false; state.failNotification = false;
    await db.$transaction(async tx => {
      const ids: string[] = [];
      for (const role of ["PM", "QA", "ADMIN", "MEMBER"] as const) ids.push((await tx.user.create({ data: { name: `Synthetic ${role}`, email: `${randomUUID()}@medpm.local`, role, status: "ACTIVE" } })).id);
      [pmId, qaId, adminId, memberId] = ids;
      projectId = (await tx.project.create({ data: { name: "Synthetic closure project", ownerId: pmId, status: "ACTIVE" } })).id;
      await tx.projectMember.createMany({ data: [qaId, adminId, memberId].map(userId => ({ projectId, userId })) });
      taskId = (await tx.task.create({ data: { projectId, title: "Synthetic final delivery", status: "DONE", requiresDeliverable: true, actualHours: 2 } })).id;
      documentId = (await tx.document.create({ data: { projectId, filename: "synthetic-final.pdf", minioKey: `synthetic/${randomUUID()}.pdf`, sha256: "a".repeat(64), fileSize: 50, mediaType: "application/pdf", storageStatus: "AVAILABLE" } })).id;
      const id = randomUUID(); deliverableId = (await tx.deliverable.create({ data: { id, seriesId: id, projectId, taskId, documentId, name: "Synthetic approved report", status: "APPROVED", createdById: pmId, submittedById: pmId, reviewedById: qaId, reviewedAt: new Date() } })).id;
      meetingId = (await tx.meetingRecord.create({ data: { projectId, title: "Synthetic final meeting", meetingDate: new Date(), content: "Synthetic final evidence", actionItems: [], requestKey: randomUUID(), createdById: pmId, visibleRoles: ["PM"] } })).id;
      await tx.auditLog.create({ data: { actorId: pmId, projectId, action: "TASK_SIGNED_AND_COMPLETED", entityType: "Task", entityId: taskId, after: { signatureReason: "确认验收与移交完成" } } });
    });
  });
  afterAll(async () => { await db.$disconnect(); await admin.$disconnect(); /* Retain isolated DB for forensic rollback evidence. */ });
  it("has all guarded tables/triggers and uses the Project primary key lookup", async () => {
    const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE 'freeze_%'`;
    expect(Number(rows[0].n)).toBe(60);
    const guards = await db.$queryRaw<{ tableName: string; eventName: string }[]>`SELECT EVENT_OBJECT_TABLE tableName, EVENT_MANIPULATION eventName FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE 'freeze_%'`;
    for (const table of FROZEN_PROJECT_TABLES) for (const event of ["INSERT", "UPDATE", "DELETE"]) expect(guards.some(g => g.tableName.toLowerCase() === table.toLowerCase() && g.eventName === event)).toBe(true);
    const plan = await db.$queryRawUnsafe<Record<string, string>[]>("EXPLAIN FORMAT=JSON SELECT status FROM Project WHERE id = ? FOR UPDATE", projectId);
    expect(Object.values(plan[0])[0]).toMatch(/"key":\s*"PRIMARY"/);
  });
  it("rejects incomplete tasks or missing approved deliverables without creating a batch", async () => {
    await db.$transaction(tx => tx.task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS" } }));
    await expect(transitionProject(projectId, "submit-acceptance", body(1), { actorId: pmId })).rejects.toMatchObject({ status: 400 });
    await db.$transaction(async tx => { await tx.task.update({ where: { id: taskId }, data: { status: "DONE" } }); await tx.deliverable.update({ where: { id: deliverableId }, data: { status: "REJECTED" } }); });
    await expect(transitionProject(projectId, "submit-acceptance", body(1), { actorId: pmId })).rejects.toMatchObject({ status: 400 }); expect(await db.projectAcceptance.count({ where: { projectId } })).toBe(0);
  });
  it("stores only bounded core evidence and hashes MySQL's stored JSON canonically", async () => {
    await transitionProject(projectId, "submit-acceptance", body(1), { actorId: pmId }); const row = await db.projectAcceptance.findFirstOrThrow({ where: { projectId } });
    expect(snapshotHash(row.snapshot)).toBe(row.snapshotSha256); expect(Object.keys(row.snapshot as object).sort()).toEqual(["deliverables", "signatureAuditIds", "tasks", "version"]);
    expect(JSON.stringify(row.snapshot)).not.toContain("Synthetic final evidence"); expect(JSON.stringify(row.snapshot)).not.toContain("minioKey");
    await expect(db.$executeRaw`UPDATE ProjectAcceptance SET snapshotSha256 = ${"b".repeat(64)} WHERE id = ${row.id}`).rejects.toThrow("ER_ACCEPTANCE_IMMUTABLE");
    await expect(db.$executeRaw`DELETE FROM ProjectAcceptance WHERE id = ${row.id}`).rejects.toThrow("ER_ACCEPTANCE_IMMUTABLE");
  });
  it("rejects a changed hash at QA approval and again after QA at final archive", async () => {
    await transitionProject(projectId, "submit-acceptance", body(1), { actorId: pmId }); const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    await db.$executeRaw`UPDATE Document SET sha256 = ${"b".repeat(64)} WHERE id = ${documentId}`;
    await expect(transitionProject(projectId, "qa-approve", body(2, p.currentAcceptanceId!), { actorId: qaId })).rejects.toThrow("快照与当前证据不一致");
    await db.$executeRaw`UPDATE Document SET sha256 = ${"a".repeat(64)} WHERE id = ${documentId}`;
    await transitionProject(projectId, "qa-approve", body(2, p.currentAcceptanceId!), { actorId: qaId });
    await db.$executeRaw`UPDATE Task SET actualHours = 3 WHERE id = ${taskId}`;
    await expect(transitionProject(projectId, "archive", body(3, p.currentAcceptanceId!), { actorId: adminId })).rejects.toThrow("快照与当前证据不一致"); expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("PENDING_ACCEPTANCE");
  });
  it("cannot archive without QA, and a resubmission cannot reuse an earlier QA approval", async () => {
    const acceptanceId = await submitAndQa();
    await transitionProject(projectId, "reject-acceptance", body(3, acceptanceId), { actorId: qaId });
    await transitionProject(projectId, "submit-acceptance", body(4), { actorId: pmId }); const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(p.currentAcceptanceId).not.toBe(acceptanceId); await expect(transitionProject(projectId, "archive", body(5, p.currentAcceptanceId!), { actorId: adminId })).rejects.toThrow("请先由 QA");
    expect(await db.projectAcceptance.count({ where: { projectId } })).toBe(2);
  });
  it.each(["audit", "notification"])("rolls back archive, reviewer state and notifications if %s fails", async failure => {
    const id = await submitAndQa(); state.failAudit = failure === "audit"; state.failNotification = failure === "notification";
    await expect(transitionProject(projectId, "archive", body(3, id), { actorId: adminId })).rejects.toThrow();
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("PENDING_ACCEPTANCE"); expect((await db.projectAcceptance.findUniqueOrThrow({ where: { id } })).state).toBe("QA_APPROVED"); expect(await db.projectNotification.count({ where: { projectId } })).toBe(0); expect(await db.auditLog.count({ where: { projectId, action: "PROJECT_ARCHIVED" } })).toBe(0);
  });
  it("raw SQL cannot insert/update/delete tasks, move assets out, or change a frozen project", async () => {
    await archive();
    await denied(() => db.$executeRaw`INSERT INTO Task (id, projectId, title, status, createdAt, updatedAt) VALUES (${randomUUID()}, ${projectId}, 'Synthetic bypass', 'TODO', NOW(3), NOW(3))`);
    await denied(() => db.$executeRaw`UPDATE Task SET title = 'Tampered' WHERE id = ${taskId}`);
    await denied(() => db.$executeRaw`DELETE FROM Task WHERE id = ${taskId}`);
    const other = await db.$transaction(tx => tx.project.create({ data: { name: "Other synthetic", ownerId: pmId } }));
    await denied(() => db.$executeRaw`UPDATE Document SET projectId = ${other.id} WHERE id = ${documentId}`);
    await denied(() => db.$executeRaw`UPDATE Deliverable SET status = 'REJECTED' WHERE id = ${deliverableId}`);
    await denied(() => db.$executeRaw`DELETE FROM MeetingRecord WHERE id = ${meetingId}`);
    await denied(() => db.$executeRaw`UPDATE ProjectMember SET active = false WHERE projectId = ${projectId} AND userId = ${memberId}`);
    await denied(() => db.$executeRaw`UPDATE Project SET status = 'ACTIVE' WHERE id = ${projectId}`);
    await denied(() => db.$executeRaw`DELETE FROM Project WHERE id = ${projectId}`);
    await expect(db.$executeRaw`DELETE FROM User WHERE id = ${pmId}`).rejects.toThrow();
  });
  it("normal service writes are frozen while download/report audits and notification reads still work", async () => {
    const id = await archive(); await expect(changeTaskStatus({ taskId, status: "IN_PROGRESS", actorId: pmId })).rejects.toMatchObject({ archived: true });
    const json = JSON.parse(await exportClosureReport(projectId, "json", { actorId: pmId })); expect(json.snapshotSha256).toBe((await db.projectAcceptance.findUniqueOrThrow({ where: { id } })).snapshotSha256); expect(json.evidence.tasks[0].actualHours).toBe("2");
    const html = await exportClosureReport(projectId, "html", { actorId: qaId }); expect(html).toContain("已归档"); expect(html).toContain("signatureAuditIds");
    expect(await db.auditLog.count({ where: { projectId, action: "DATA_EXPORTED" } })).toBe(2);
    expect(await db.projectNotification.count({ where: { projectId } })).toBe(4);
    await db.$transaction(tx => tx.projectNotification.updateMany({ where: { projectId, recipientId: memberId }, data: { readAt: new Date() } }));
    expect((await db.projectNotification.findFirstOrThrow({ where: { projectId, recipientId: memberId } })).readAt).not.toBeNull();
    await expect(transitionProject(projectId, "archive", body(4, id), { actorId: adminId })).rejects.toMatchObject({ archived: true }); expect(await db.projectNotification.count({ where: { projectId } })).toBe(4);
  });
  it("background worker candidates ignore archived projects", async () => {
    await db.$transaction(tx => tx.syncFailure.create({ data: { projectId, entityType: "DocumentParseJob", entityId: randomUUID(), target: "MINIO_PARSE_ARTIFACT_CLEANUP", payload: {}, error: "Synthetic cleanup", createdAt: new Date(Date.now() - 10 * 60000) } }));
    await archive(); const embed = vi.fn(async () => Array(1536).fill(0)); const upsert = vi.fn(async () => {}); const put = vi.fn(async () => {});
    expect(await syncAssetSourceTick(put)).toBe(false); expect(await buildDocumentChunksTick()).toBe(false); expect(await syncDocumentVectorTick({ embed, upsert })).toBe(false); expect(embed).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
    expect(await artifactWork()).toBeNull();
    const activeWork = await db.$transaction(async tx => {
      const active = await tx.project.create({ data: { name: "Synthetic active cleanup", ownerId: pmId, status: "ACTIVE" } });
      return tx.syncFailure.create({ data: { projectId: active.id, entityType: "DocumentParseJob", entityId: randomUUID(), target: "MINIO_PARSE_ARTIFACT_CLEANUP", payload: {}, error: "Synthetic cleanup", createdAt: new Date(Date.now() - 7 * 60000) } });
    });
    expect((await artifactWork())?.id).toBe(activeWork.id);
  });
  it("archive racing with a raw SQL write either rejects the change or rejects the mismatched archive", async () => {
    const id = await submitAndQa();
    await Promise.allSettled([transitionProject(projectId, "archive", body(3, id), { actorId: adminId }), db.$executeRaw`UPDATE Task SET actualHours = 7 WHERE id = ${taskId}`]);
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } }); const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    if (project.status === "ARCHIVED") expect(task.actualHours?.toString()).toBe("2");
    else { expect(project.status).toBe("PENDING_ACCEPTANCE"); expect(await db.auditLog.count({ where: { projectId, action: "PROJECT_ARCHIVED" } })).toBe(0); }
  });
  it("rejects a tampered current acceptance pointer from another project", async () => {
    const foreignId = await submitAndQa();
    const other = await db.$transaction(async tx => {
      await tx.project.update({ where: { id: projectId }, data: { currentAcceptanceId: null } });
      const p = await tx.project.create({ data: { name: "Synthetic acceptance pointer tampering", ownerId: pmId, status: "PENDING_ACCEPTANCE", currentAcceptanceId: foreignId } });
      await tx.projectMember.createMany({ data: [qaId, adminId].map(userId => ({ projectId: p.id, userId })) });
      return p;
    });
    await expect(transitionProject(other.id, "archive", body(1, foreignId), { actorId: adminId })).rejects.toThrow("验收轮次与项目不匹配");
    expect((await db.project.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("PENDING_ACCEPTANCE");
  });
  it("direct SQL guards cover requirements, tests, dependencies, AI suggestions and new asset inserts", async () => {
    let requirementId = "", testId = "", edgeId = "", suggestionId = "";
    await db.$transaction(async tx => {
      requirementId = (await tx.requirement.create({ data: { projectId, title: "Synthetic requirement", content: "Synthetic evidence" } })).id;
      testId = (await tx.testCase.create({ data: { requirementId, title: "Synthetic verification" } })).id;
      const parent = await tx.task.create({ data: { projectId, title: "Synthetic prerequisite", status: "DONE", actualHours: 1 } }); edgeId = (await tx.taskDependency.create({ data: { taskId, dependsOnTaskId: parent.id } })).id;
      suggestionId = (await tx.aiSuggestion.create({ data: { projectId, type: "WBS", input: {}, output: {}, status: "PENDING" } })).id;
    }); await archive();
    await denied(() => db.$executeRaw`UPDATE Requirement SET content = 'Tampered' WHERE id = ${requirementId}`);
    await denied(() => db.$executeRaw`UPDATE TestCase SET status = 'FAILED' WHERE id = ${testId}`);
    await denied(() => db.$executeRaw`DELETE FROM TaskDependency WHERE id = ${edgeId}`);
    await denied(() => db.$executeRaw`UPDATE AiSuggestion SET status = 'ACCEPTED' WHERE id = ${suggestionId}`);
    await denied(() => db.$executeRaw`INSERT INTO MeetingRecord (id, projectId, title, meetingDate, content, actionItems, createdById, requestKey, visibleRoles, createdAt, updatedAt) VALUES (${randomUUID()}, ${projectId}, 'Synthetic bypass', NOW(3), 'No change', JSON_ARRAY(), ${pmId}, ${randomUUID()}, JSON_ARRAY('PM'), NOW(3), NOW(3))`);
  });
  it("preserves legacy COMPLETED without auto-archiving and requires explicit activation", async () => {
    await db.$transaction(tx => tx.project.update({ where: { id: projectId }, data: { status: "COMPLETED" } }));
    await expect(transitionProject(projectId, "submit-acceptance", body(1), { actorId: pmId })).rejects.toMatchObject({ status: 409 });
    await transitionProject(projectId, "activate", body(1), { actorId: pmId }); expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("ACTIVE"); expect(await db.projectAcceptance.count({ where: { projectId } })).toBe(0);
  });
});
