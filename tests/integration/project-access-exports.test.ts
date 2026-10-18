import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient, type Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ client: undefined as unknown as import("@prisma/client").PrismaClient, actor: null as { id: string; role: import("@prisma/client").Role } | null }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.client; } }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: async () => state.actor }));
import { hashPassword } from "@/modules/auth/password";
import { hasProjectAccess } from "@/modules/auth/project-access";
import { projectScoped } from "@/modules/auth/project-scope-http";
import { getProjectMembers, setProjectMember } from "@/modules/projects/members";
import { recordAudit, changeTaskStatus, createTask, assignTask, acceptWbsSuggestion, reviewAiSuggestion, reviewRiskSuggestion } from "@/modules/audit/service";
import { generateComplianceExport, downloadComplianceExport, cleanupComplianceExport } from "@/modules/exports/services";
import { GET as listProjects } from "@/app/api/projects/route";
import { GET as listAudit } from "@/app/api/audit/route";
import { PATCH as updateTaskRoute } from "@/app/api/tasks/[taskId]/route";
import { POST as createTaskRoute } from "@/app/api/projects/[projectId]/tasks/route";
import { PATCH as reviewWbsRoute } from "@/app/api/ai/wbs/[suggestionId]/route";
import { PATCH as reviewRiskRoute } from "@/app/api/ai/risk/[suggestionId]/route";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { createProject, saveTraceability } from "@/modules/projects/services";
import type { DocumentStorage } from "@/modules/documents/storage";
if (!process.env.DATABASE_URL || !process.env.MYSQL_ROOT_PASSWORD) throw new Error("Local MySQL credentials required");
const source = new URL(process.env.DATABASE_URL); if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Only local MySQL allowed");
const name = `medpm_access_it_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
const testUrl = new URL(source); testUrl.pathname = `/${name}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } }); const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } }); state.client = db;
let owner: string; let qa: string; let member: string; let outsider: string; let administrator: string; let projectId: string; let other: string; let task: string; let doc: string; let suggestion: string;
const objects = new Map<string, Buffer>();
const storage: DocumentStorage = { put: vi.fn(async (key, bytes) => { objects.set(key, Buffer.from(bytes)); }), get: vi.fn(async (key) => { const bytes = objects.get(key); if (!bytes) throw new Error("Missing object"); return bytes; }), remove: vi.fn(async (key) => { objects.delete(key); }) };
const exportInput = () => ({ requestKey: randomUUID(), format: "json" as const });
const actor = () => ({ actorId: qa, ip: "192.0.2.100", userAgent: "synthetic-export-test" });
async function login(id: string, role: Role) { state.actor = { id, role }; }
async function revoke() { return setProjectMember(projectId, { userId: qa, active: false, expectedVersion: 1 }, { actorId: owner }); }
function sql(input: string) { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, input, stdio: "pipe" }); }
describe.sequential("project isolation and compliance exports in isolated MySQL", () => {
  beforeAll(async () => {
    if (!/^medpm_access_it_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid database");
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });
    await db.$transaction((tx) => tx.user.create({ data: { id: SYSTEM_USER_ID, name: "Synthetic system", email: "system@medpm.local", isSystem: true, status: "DISABLED" } }));
  }, 60000);
  beforeEach(async () => {
    objects.clear(); vi.clearAllMocks(); state.actor = null;
    await db.$transaction(async (tx) => {
      const user = async (role: Role) => (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: `Synthetic ${role}`, role, status: "ACTIVE" } })).id;
      owner = await user("PM"); qa = await user("QA"); member = await user("MEMBER"); outsider = await user("PM"); administrator = await user("ADMIN");
      projectId = (await tx.project.create({ data: { name: "Synthetic authorized project", ownerId: owner } })).id;
      other = (await tx.project.create({ data: { name: "Synthetic hidden project", ownerId: outsider } })).id;
      await tx.projectMember.createMany({ data: [qa, member].map((userId) => ({ projectId, userId })) });
      task = (await tx.task.create({ data: { projectId, title: "=Synthetic formula" } })).id;
      await tx.task.create({ data: { projectId: other, title: "HIDDEN_SYNTHETIC_TASK" } });
      doc = (await tx.document.create({ data: { projectId, filename: "Synthetic.pdf", minioKey: `synthetic/${randomUUID()}`, mediaType: "application/pdf" } })).id;
      suggestion = (await tx.aiSuggestion.create({ data: { projectId, type: "WBS", input: {}, output: {} } })).id;
      await tx.auditLog.create({ data: { actorId: owner, projectId, action: "TASK_CREATED", entityType: "Task", entityId: task } });
      await tx.auditLog.create({ data: { actorId: outsider, projectId: other, action: "TASK_CREATED", entityType: "Project", entityId: other } });
    });
  });
  afterAll(async () => { await db.$disconnect(); try { if (/^medpm_access_it_[a-f0-9]{32}$/.test(name)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await admin.$disconnect(); } });
  it("filters project and QA audit lists and preserves owner/admin access", async () => {
    await login(qa, "QA"); expect((await (await listProjects()).json()).data.map((r: { id: string }) => r.id)).toEqual([projectId]);
    const audits = await (await listAudit(new Request("http://localhost/api/audit"))).json();
    expect(JSON.stringify(audits)).toContain(task); expect(JSON.stringify(audits)).not.toContain(other);
    expect(await hasProjectAccess({ id: owner, role: "PM" }, projectId)).toBe(true);
    expect(await hasProjectAccess({ id: administrator, role: "ADMIN" }, other)).toBe(true);
    expect(await hasProjectAccess({ id: qa, role: "QA" }, other)).toBe(false);
  });
  it("denies indirect entity URLs before invoking the handler", async () => {
    const handler = vi.fn(() => Response.json({ ok: true })); const route = projectScoped(handler);
    await login(outsider, "PM");
    for (const path of [`projects/${projectId}/traceability`, `tasks/${task}`, `documents/${doc}/download`, `ai/wbs/${suggestion}`, `audit/summaries/${suggestion}`]) expect((await route(new Request(`http://localhost/api/${path}`))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled(); state.actor = null; expect((await route(new Request(`http://localhost/api/projects/${projectId}`))).status).toBe(401);
  });
  it("only owner/admin manage grants, protects owner and rejects stale updates", async () => {
    await expect(setProjectMember(projectId, { userId: outsider, active: true, expectedVersion: 0 }, { actorId: member })).rejects.toMatchObject({ status: 403 });
    await expect(setProjectMember(projectId, { userId: owner, active: false, expectedVersion: 0 }, { actorId: owner })).rejects.toMatchObject({ status: 409 });
    await setProjectMember(projectId, { userId: outsider, active: true, expectedVersion: 0 }, { actorId: owner });
    await expect(setProjectMember(projectId, { userId: member, active: false, expectedVersion: 1 }, { actorId: outsider })).rejects.toMatchObject({ status: 403 });
    await revoke(); await expect(revoke()).rejects.toMatchObject({ status: 409 });
    expect((await getProjectMembers(projectId, { id: member, role: "MEMBER" })).candidates).toEqual([]);
    expect(await db.auditLog.count({ where: { projectId, action: "PROJECT_MEMBER_UPDATED" } })).toBe(2);
  });
  it("rejects an audited write using a snapshot established before revocation", async () => {
    await expect(db.$transaction(async (tx) => {
      await tx.projectMember.findMany({ where: { projectId, userId: qa } });
      await revoke();
      await tx.task.update({ where: { id: task }, data: { title: "Unauthorized change" } });
      await recordAudit(tx, { actorId: qa, projectId, action: "TASK_STATUS_CHANGED", entityType: "Task", entityId: task });
    }, { isolationLevel: "RepeatableRead" })).rejects.toMatchObject({ status: 403 });
    expect((await db.task.findUniqueOrThrow({ where: { id: task } })).title).toBe("=Synthetic formula");
  });
  it("rejects privileged mutations after a PM role is revoked without removing project access", async () => {
    await db.$transaction((tx) => tx.user.update({ where: { id: owner }, data: { role: "MEMBER" } }));
    expect(await hasProjectAccess({ id: owner, role: "MEMBER" }, projectId)).toBe(true);
    const before = await db.auditLog.count({ where: { projectId } });
    for (const operation of [
      () => createTask({ projectId, title: "Unauthorized synthetic task", actorId: owner }),
      () => createProject({ name: "Unauthorized synthetic project", description: "Synthetic only", initializeStandardTasks: true }, { actorId: owner }),
      () => saveTraceability(projectId, { kind: "requirement", title: "Unauthorized synthetic requirement", content: "Synthetic only", status: "DRAFT" }, { actorId: owner }),
      () => saveTraceability(projectId, { kind: "testCase", requirementId: randomUUID(), title: "Unauthorized synthetic test", status: "NOT_RUN" }, { actorId: owner }),
      () => assignTask({ taskId: task, assigneeId: member, actorId: owner }),
      () => acceptWbsSuggestion({ suggestionId: suggestion, actorId: owner }),
      () => reviewAiSuggestion({ suggestionId: suggestion, decision: "REJECTED", actorId: owner }),
      () => reviewRiskSuggestion({ suggestionId: suggestion, decision: "IGNORED", actorId: owner }),
    ]) await expect(operation()).rejects.toMatchObject({ status: 403 });
    expect(await db.task.count({ where: { projectId } })).toBe(1);
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: suggestion } })).status).toBe("PENDING");
    expect(await db.auditLog.count({ where: { projectId } })).toBe(before);
  });
  it("checks member assignment and completed status inside the business transaction", async () => {
    await expect(changeTaskStatus({ taskId: task, status: "IN_PROGRESS", actorId: member })).rejects.toMatchObject({ status: 403 });
    await assignTask({ taskId: task, assigneeId: member, actorId: owner });
    await changeTaskStatus({ taskId: task, status: "IN_PROGRESS", actorId: member });
    const signaturePassword = "Synthetic-signature-123";
    const passwordHash = await hashPassword(signaturePassword);
    await db.$transaction(tx => tx.user.update({ where: { id: member }, data: { passwordHash } }));
    await changeTaskStatus({ taskId: task, status: "DONE", actualHours: 2, actorId: member, signaturePassword, signatureReason: "确认开发完成" });
    const before = await db.auditLog.count({ where: { entityId: task } });
    await expect(changeTaskStatus({ taskId: task, status: "TODO", actorId: member })).rejects.toMatchObject({ status: 403 });
    expect((await db.task.findUniqueOrThrow({ where: { id: task } })).status).toBe("DONE");
    expect(await db.auditLog.count({ where: { entityId: task } })).toBe(before);
  });
  it("serializes a member status update with reassignment and rejects the old member afterwards", async () => {
    await assignTask({ taskId: task, assigneeId: member, actorId: owner });
    let signalRead = () => {}; let resume = () => {};
    const read = new Promise<void>((resolve) => { signalRead = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let signalProjectAttempt = () => {};
    const projectAttempt = new Promise<void>((resolve) => { signalProjectAttempt = resolve; });
    let competing = false;
    let pause = true;
    const pausedClient = db.$extends({ query: {
      async $queryRaw({ args, query }) {
        if (competing && JSON.stringify(args).includes("FROM Project")) signalProjectAttempt();
        return query(args);
      }, task: { async findUnique({ args, query }) {
      const result = await query(args);
      if (pause && result?.id === task) { pause = false; signalRead(); await gate; }
      return result;
    } } } });
    state.client = pausedClient as unknown as PrismaClient;
    const pending = changeTaskStatus({ taskId: task, status: "IN_PROGRESS", actorId: member }).catch((error: unknown) => error);
    let reassignment: ReturnType<typeof assignTask> | undefined;
    try {
      await read;
      // Reassignment waits at the project lock; it cannot hold Task while waiting for Project.
      competing = true;
      reassignment = assignTask({ taskId: task, assigneeId: owner, actorId: owner });
      await projectAttempt;
    } finally { state.client = db; pause = false; resume(); }
    await expect(pending).resolves.toMatchObject({ status: "IN_PROGRESS" });
    await reassignment;
    await expect(changeTaskStatus({ taskId: task, status: "BLOCKED", actorId: member })).rejects.toMatchObject({ status: 403 });
    expect((await db.task.findUniqueOrThrow({ where: { id: task } }))).toMatchObject({ assigneeId: owner, status: "IN_PROGRESS" });
    expect(await db.auditLog.count({ where: { entityId: task, action: "TASK_STATUS_CHANGED" } })).toBe(1);
  });
  it("exports a consistent scoped snapshot, hashes bytes and audits repeated downloads", async () => {
    const input = exportInput(); const file = await generateComplianceExport(projectId, input, actor(), storage); const text = file.bytes.toString();
    expect(text).toContain(task); expect(text).not.toContain("HIDDEN_SYNTHETIC_TASK"); expect(text).not.toContain(other);
    const row = await db.complianceExport.findUniqueOrThrow({ where: { id: file.id } }); expect(row.status).toBe("AVAILABLE"); expect(row.sha256).toBe(createHash("sha256").update(file.bytes).digest("hex"));
    expect((await generateComplianceExport(projectId, input, actor(), storage)).bytes).toEqual(file.bytes); expect(storage.put).toHaveBeenCalledOnce();
    const logs = await db.auditLog.findMany({ where: { entityId: file.id, action: "DATA_EXPORTED" } }); expect(logs).toHaveLength(2); expect(logs[0]).toMatchObject({ actorId: qa, ip: "192.0.2.100", userAgent: "synthetic-export-test", after: { scope: { projectId, counts: { tasks: 1 } }, sha256: row.sha256 } });
    await expect(generateComplianceExport(projectId, { ...input, format: "csv" }, actor(), storage)).rejects.toMatchObject({ status: 409 });
  });
  it("filters audit times without implying a historical business snapshot", async () => {
    const file = await generateComplianceExport(projectId, { ...exportInput(), from: "2099-01-01T00:00:00Z" }, actor(), storage);
    const report = JSON.parse(file.bytes.toString()); expect(report.auditLogs).toEqual([]); expect(report.tasks).toHaveLength(1); expect(report.scope.auditTimeFilterOnly).toBe(true);
  });
  it("denies PM exports and prevents downloads after revocation", async () => {
    await expect(generateComplianceExport(projectId, exportInput(), { actorId: owner }, storage)).rejects.toMatchObject({ status: 403 });
    const file = await generateComplianceExport(projectId, exportInput(), actor(), storage); await revoke();
    await expect(downloadComplianceExport(file.id, actor(), storage)).rejects.toMatchObject({ status: 403 }); expect(storage.get).not.toHaveBeenCalled();
  });
  it("does not release bytes when membership is revoked during object upload", async () => {
    const failing: DocumentStorage = { ...storage, put: async (key, bytes, hash) => { await storage.put(key, bytes, hash); await revoke(); } };
    await expect(generateComplianceExport(projectId, exportInput(), actor(), failing)).rejects.toMatchObject({ status: 403 });
    const row = await db.complianceExport.findFirstOrThrow({ where: { projectId } }); expect(row.status).toBe("FAILED"); expect(await db.syncFailure.count({ where: { entityId: row.id, target: "MINIO_EXPORT_CLEANUP" } })).toBe(1);
    await cleanupComplianceExport(row.id, { actorId: administrator }, storage); expect(objects.size).toBe(0);
  });
  it("records storage failures and rejects altered objects without an export audit", async () => {
    await expect(generateComplianceExport(projectId, exportInput(), actor(), { ...storage, put: async () => { throw new Error("Synthetic unavailable storage"); } })).rejects.toMatchObject({ status: 503 });
    const file = await generateComplianceExport(projectId, exportInput(), actor(), storage); const row = await db.complianceExport.findUniqueOrThrow({ where: { id: file.id } }); objects.set(row.minioKey, Buffer.from("tampered"));
    await expect(downloadComplianceExport(file.id, actor(), storage)).rejects.toMatchObject({ status: 502 }); expect(await db.auditLog.count({ where: { entityId: file.id, action: "DATA_EXPORTED" } })).toBe(1);
  });
  it("rechecks authorization after fetching download bytes", async () => {
    const file = await generateComplianceExport(projectId, exportInput(), actor(), storage);
    await expect(downloadComplianceExport(file.id, actor(), { ...storage, get: async (key) => { const bytes = await storage.get(key); await revoke(); return bytes; } })).rejects.toMatchObject({ status: 403 });
    expect(await db.auditLog.count({ where: { entityId: file.id, action: "DATA_EXPORTED" } })).toBe(1);
  });
  it("recovers abandoned preparation and audits cleanup without deleting the export record", async () => {
    let id: string = "";
    await db.$transaction(async (tx) => { id = (await tx.complianceExport.create({ data: { projectId, actorId: qa, requestKey: randomUUID(), format: "json", scope: { projectId }, minioKey: `synthetic/stale/${randomUUID()}`, sha256: "a".repeat(64), fileSize: 1, createdAt: new Date(Date.now() - 660000) } })).id; });
    await cleanupComplianceExport(id, actor(), storage);
    expect((await db.complianceExport.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED"); expect(await db.syncFailure.count({ where: { entityId: id } })).toBe(0);
    expect((await db.auditLog.findMany({ where: { entityId: id } })).map((r) => r.action)).toEqual(expect.arrayContaining(["COMPLIANCE_EXPORT_FAILED", "COMPLIANCE_EXPORT_CLEANED"]));
  });
  it("rolls back grants and export preparation when audit persistence fails", async () => {
    sql("CREATE TRIGGER access_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure';");
    try { await expect(revoke()).rejects.toBeDefined(); await expect(generateComplianceExport(projectId, exportInput(), actor(), storage)).rejects.toBeDefined(); expect(await db.complianceExport.count({ where: { projectId } })).toBe(0); expect(await hasProjectAccess({ id: qa, role: "QA" }, projectId)).toBe(true); expect(storage.put).not.toHaveBeenCalled(); }
    finally { sql("DROP TRIGGER access_it_fail_audit;"); }
  });
  it("returns safe 500 responses and rolls back all task/WBS/risk mutations when audit SQL fails", async () => {
    await login(owner, "PM");
    const risk = await db.$transaction(async (tx) => {
      await tx.aiSuggestion.update({ where: { id: suggestion }, data: { output: { title: "Synthetic WBS", description: "Synthetic only", estimateHours: 2, suggestedRole: "MEMBER", dependencyIds: [], dependencyTitles: [] } } });
      return tx.aiSuggestion.create({ data: { projectId, type: "RISK", input: {}, output: {} } });
    });
    const request = (path: string, body: unknown, method = "PATCH") => new Request(`http://localhost/api/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const before = await db.auditLog.count({ where: { projectId } });
    sql("CREATE TRIGGER access_it_safe_error BEFORE INSERT ON AuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic-secret-db-detail';");
    try {
      for (const operation of [
        () => createTaskRoute(request(`projects/${projectId}/tasks`, { title: "Synthetic rejected task" }, "POST"), { params: Promise.resolve({ projectId }) }),
        () => updateTaskRoute(request(`tasks/${task}`, { assigneeId: member }), { params: Promise.resolve({ taskId: task }) }),
        () => updateTaskRoute(request(`tasks/${task}`, { status: "IN_PROGRESS" }), { params: Promise.resolve({ taskId: task }) }),
        () => reviewWbsRoute(request(`ai/wbs/${suggestion}`, { decision: "ACCEPTED" }), { params: Promise.resolve({ suggestionId: suggestion }) }),
        () => reviewWbsRoute(request(`ai/wbs/${suggestion}`, { decision: "REJECTED" }), { params: Promise.resolve({ suggestionId: suggestion }) }),
        () => reviewRiskRoute(request(`ai/risk/${risk.id}`, { decision: "HANDLED" }), { params: Promise.resolve({ suggestionId: risk.id }) }),
      ]) {
        const response = await operation(); expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "操作失败，请稍后重试" });
      }
      expect(await db.task.count({ where: { projectId } })).toBe(1);
      expect(await db.task.findUniqueOrThrow({ where: { id: task } })).toMatchObject({ status: "TODO", assigneeId: null });
      expect(await db.aiSuggestion.count({ where: { projectId, status: "PENDING" } })).toBe(2);
      expect(await db.auditLog.count({ where: { projectId } })).toBe(before);
    } finally { sql("DROP TRIGGER access_it_safe_error;"); }
  });
  it("withholds bytes and queues cleanup if the final export audit fails", async () => {
    const interrupted: DocumentStorage = { ...storage, put: async (key, bytes, hash) => { await storage.put(key, bytes, hash); sql("CREATE TRIGGER access_it_fail_export_audit BEFORE INSERT ON AuditLog FOR EACH ROW BEGIN IF NEW.action = 'DATA_EXPORTED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic export audit failure'; END IF; END;"); } };
    try { await expect(generateComplianceExport(projectId, exportInput(), actor(), interrupted)).rejects.toMatchObject({ status: 503 }); expect((await db.complianceExport.findFirstOrThrow({ where: { projectId } })).status).toBe("FAILED"); }
    finally { sql("DROP TRIGGER IF EXISTS access_it_fail_export_audit;"); }
  });
  it("rolls back only the new tables and backfills explicit responsibility when reapplied", async () => {
    await db.$transaction((tx) => tx.task.update({ where: { id: task }, data: { assigneeId: member } }));
    const count = await db.auditLog.count();
    sql(readFileSync("prisma/migrations/20261015060000_project_members_compliance_exports/down.sql", "utf8"));
    expect(await db.auditLog.count()).toBe(count); expect(await db.task.count({ where: { id: task } })).toBe(1);
    sql(readFileSync("prisma/migrations/20261015060000_project_members_compliance_exports/migration.sql", "utf8"));
    expect(await db.projectMember.findMany({ where: { projectId }, select: { userId: true } })).toEqual(expect.arrayContaining([{ userId: owner }, { userId: member }]));
    expect(await hasProjectAccess({ id: qa, role: "QA" }, projectId)).toBe(false);
  });
});
