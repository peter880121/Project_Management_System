import "dotenv/config";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { SYSTEM_USER_ID } from "@/lib/system-user";

if (!process.env.DATABASE_URL || !process.env.MYSQL_ROOT_PASSWORD) throw new Error("User integration tests require local DATABASE_URL and MYSQL_ROOT_PASSWORD");
const source = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("User integration tests require local MySQL");
const databaseName = `medpm_users_it_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
const testUrl = new URL(source); testUrl.pathname = `/${databaseName}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
const baseURL = "http://127.0.0.1:4420";
const password = `${randomBytes(18).toString("hex")}Aa1`;
let passwordHash: string;
let server: ChildProcess | undefined;
let actorId: string;
let targetId: string;
let actorCookie: string;
let targetCookie: string;

async function http(path: string, method = "GET", cookie?: string, body?: unknown) {
  return fetch(`${baseURL}${path}`, { method, headers: {
    "content-type": "application/json", "user-agent": "users-http-integration", "x-real-ip": "192.0.2.52", ...(cookie ? { cookie } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(id: string) {
  const response = await http("/api/auth/login", "POST", undefined, { email: `${id}@medpm.local`, password });
  expect(response.status).toBe(200);
  const cookie = /medpm_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  if (!cookie) throw new Error("Login did not issue a session cookie");
  return `medpm_session=${cookie}`;
}
async function audits(action: string) { return db.auditLog.findMany({ where: { actorId, action, entityId: targetId } }); }
function executeFixtureDDL(sql: string) {
  // MySQL CREATE TRIGGER is unsupported by Prisma's prepared-statement query API.
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() }, input: sql, stdio: ["pipe", "pipe", "pipe"],
  });
}

describe.sequential("User management APIs over HTTP with real MySQL", () => {
  beforeAll(async () => {
    // Only the generated, isolated database is created/migrated/dropped; source DB is never written.
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe" });
    passwordHash = await hashPassword(password);
    await db.$transaction((tx) => tx.user.create({ data: { id: SYSTEM_USER_ID, email: "system@medpm.local", name: "Synthetic system", isSystem: true, status: "DISABLED" } }));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "-p", "4420"], {
      env: { ...process.env, NODE_ENV: "development", DATABASE_URL: testUrl.toString(), SESSION_SECRET: randomBytes(32).toString("hex") }, stdio: ["ignore", "pipe", "pipe"],
    });
    // Drain output without exposing request/Prisma arguments on failure.
    server.stdout?.on("data", () => {}); server.stderr?.on("data", () => {});
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error("Integration server exited before ready");
      try { if ((await http("/api/auth/login")).status === 405) return; } catch { /* Starting. */ }
      await delay(300);
    }
    throw new Error("Integration server startup timed out");
  }, 120_000);
  beforeEach(async () => {
    actorId = randomUUID(); targetId = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.user.create({ data: { id: actorId, email: `${actorId}@medpm.local`, name: "Synthetic Admin", role: "ADMIN", status: "ACTIVE", passwordHash } });
      await tx.user.create({ data: { id: targetId, email: `${targetId}@medpm.local`, name: "Synthetic Member", role: "MEMBER", status: "ACTIVE", passwordHash } });
    });
    actorCookie = await login(actorId); targetCookie = await login(targetId);
  });
  afterEach(async () => { await db.$transaction((tx) => tx.session.deleteMany({ where: { userId: { in: [actorId, targetId] } } })); });
  afterAll(async () => {
    try {
      if (server && server.exitCode === null) {
        const exited = new Promise<void>((resolve) => server!.once("exit", () => resolve()));
        server.kill(); await Promise.race([exited, delay(5000)]);
      }
    } finally {
      await db.$disconnect();
      try { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${databaseName}\``); } finally { await admin.$disconnect(); }
    }
  });

  it("enforces permissions on all management endpoints", async () => {
    for (const cookie of [undefined, targetCookie]) {
      const status = cookie ? 403 : 401;
      expect((await http("/api/users", "GET", cookie)).status).toBe(status);
      expect((await http("/api/users", "POST", cookie, {})).status).toBe(status);
      expect((await http(`/api/users/${targetId}/role`, "PATCH", cookie, { role: "QA" })).status).toBe(status);
      expect((await http(`/api/users/${targetId}/status`, "PATCH", cookie, { status: "DISABLED" })).status).toBe(status);
    }
  });
  it("filters and paginates non-system users with stable safe fields and totals", async () => {
    const keyword = `filter-${randomUUID()}`;
    await db.$transaction(async (tx) => {
      for (let index = 0; index < 4; index += 1) await tx.user.create({ data: { name: `${keyword}-${index}`, email: `${keyword}-${index}@medpm.local`, role: "QA", status: "ACTIVE", isSystem: index === 3 } });
    });
    const first = await (await http(`/api/users?role=QA&status=ACTIVE&keyword=${keyword}&pageSize=2`, "GET", actorCookie)).json();
    const second = await (await http(`/api/users?role=QA&status=ACTIVE&keyword=${keyword}&pageSize=2&page=2`, "GET", actorCookie)).json();
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(first.data).toHaveLength(2); expect(second.data).toHaveLength(1);
    expect(new Set([...first.data, ...second.data].map((user) => user.id)).size).toBe(3);
    expect(Object.keys(first.data[0]).sort()).toEqual(["createdAt", "email", "id", "lastLoginAt", "name", "role", "status"]);
    expect((await http("/api/users?pageSize=101", "GET", actorCookie)).status).toBe(400);
  });
  it("creates ACTIVE users with hashed passwords and a safe creation audit", async () => {
    const email = `created-${randomUUID()}@medpm.local`;
    const response = await http("/api/users", "POST", actorCookie, { name: "Synthetic Created", email, role: "QA", initialPassword: password });
    expect(response.status).toBe(201);
    const { user } = await response.json();
    expect(user).toMatchObject({ email, role: "QA", status: "ACTIVE" });
    expect(user).not.toHaveProperty("passwordHash");
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(password, stored.passwordHash!)).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId, entityId: user.id, action: "USER_CREATED_BY_ADMIN" } });
    expect(audit).toMatchObject({ entityType: "User", ip: "192.0.2.52", userAgent: "users-http-integration", after: { status: "ACTIVE", role: "QA" } });
    expect(audit.before).toBeNull();
    expect(JSON.stringify(audit)).not.toContain(password); expect(JSON.stringify(audit)).not.toContain(stored.passwordHash!);
    expect((await http("/api/users", "POST", actorCookie, { name: "Duplicate", email, role: "QA", initialPassword: password })).status).toBe(409);
  });
  it("changes roles with audit and applies the new permission to the existing cookie", async () => {
    expect((await http("/api/users/options", "GET", targetCookie)).status).toBe(403);
    expect((await http(`/api/users/${targetId}/role`, "PATCH", actorCookie, { role: "PM" })).status).toBe(200);
    expect((await http("/api/users/options", "GET", targetCookie)).status).toBe(200);
    expect(await audits("PERMISSION_CHANGED")).toMatchObject([{ before: { role: "MEMBER" }, after: { role: "PM" } }]);
  });
  it("rejects self, system, missing targets and invalid input without mutation", async () => {
    for (const path of ["role", "status"]) {
      const body = path === "role" ? { role: "QA" } : { status: "DISABLED" };
      expect((await http(`/api/users/${actorId}/${path}`, "PATCH", actorCookie, body)).status).toBe(403);
      expect((await http(`/api/users/${SYSTEM_USER_ID}/${path}`, "PATCH", actorCookie, body)).status).toBe(403);
      expect((await http(`/api/users/${randomUUID()}/${path}`, "PATCH", actorCookie, body)).status).toBe(404);
    }
    expect((await http(`/api/users/${targetId}/status`, "PATCH", actorCookie, { status: "PENDING" })).status).toBe(400);
    expect(await audits("USER_STATUS_CHANGED")).toHaveLength(0);
  });
  it("counts only three active sessions out of five and never restores them on re-enable", async () => {
    await db.$transaction(async (tx) => {
      for (let index = 0; index < 4; index += 1) await tx.session.create({ data: { userId: targetId, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + (index < 2 ? 60_000 : -60_000)) } });
    });
    expect(await db.session.count({ where: { userId: targetId } })).toBe(5);
    expect((await http(`/api/users/${targetId}/status`, "PATCH", actorCookie, { status: "DISABLED" })).status).toBe(200);
    expect(await audits("USER_STATUS_CHANGED")).toMatchObject([{ before: { status: "ACTIVE" }, after: { status: "DISABLED", revokedActiveSessionCount: 3 } }]);
    expect(await db.session.count({ where: { userId: targetId, revokedAt: { not: null } } })).toBe(3);
    expect((await http("/api/auth/me", "GET", targetCookie)).status).toBe(401);
    expect((await http(`/api/users/${targetId}/status`, "PATCH", actorCookie, { status: "ACTIVE" })).status).toBe(200);
    expect((await http("/api/auth/me", "GET", targetCookie)).status).toBe(401);
  });
  it("activates PENDING with audit and rejects conflicting/repeated transitions", async () => {
    await db.$transaction((tx) => tx.user.update({ where: { id: targetId }, data: { status: "PENDING" } }));
    const conflict = await http(`/api/users/${targetId}/status`, "PATCH", actorCookie, { status: "DISABLED" });
    expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: "账号状态已变化，请刷新" });
    expect((await http(`/api/users/${targetId}/status`, "PATCH", actorCookie, { status: "ACTIVE" })).status).toBe(200);
    expect(await audits("USER_STATUS_CHANGED")).toMatchObject([{ before: { status: "PENDING" }, after: { status: "ACTIVE", revokedActiveSessionCount: 0 } }]);
  });
  it("serializes competing disables into one success and one 409 with one audit", async () => {
    const results = await Promise.all([http(`/api/users/${targetId}/status`, "PATCH", actorCookie, { status: "DISABLED" }), http(`/api/users/${targetId}/status`, "PATCH", actorCookie, { status: "DISABLED" })]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await audits("USER_STATUS_CHANGED")).toHaveLength(1);
  });
  it("rolls back create, role, status and session revocation if audit insertion fails", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: targetId } });
    const sessions = await db.session.findMany({ where: { userId: targetId } });
    const email = `rollback-${randomUUID()}@medpm.local`;
    // Test-only trigger in the isolated DB; immutable audit update/delete triggers remain intact.
    executeFixtureDDL("CREATE TRIGGER users_it_fail_audit BEFORE INSERT ON AuditLog FOR EACH ROW BEGIN IF NEW.action IN ('USER_CREATED_BY_ADMIN','PERMISSION_CHANGED','USER_STATUS_CHANGED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit failure'; END IF; END;");
    try {
      expect((await http("/api/users", "POST", actorCookie, { name: "Rollback", email, role: "MEMBER", initialPassword: password })).status).toBe(500);
      expect((await http(`/api/users/${targetId}/role`, "PATCH", actorCookie, { role: "QA" })).status).toBe(500);
      expect((await http(`/api/users/${targetId}/status`, "PATCH", actorCookie, { status: "DISABLED" })).status).toBe(500);
      expect(await db.user.findUnique({ where: { email } })).toBeNull();
      expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toEqual(before);
      expect(await db.session.findMany({ where: { userId: targetId } })).toEqual(sessions);
      expect(await audits("PERMISSION_CHANGED")).toHaveLength(0); expect(await audits("USER_STATUS_CHANGED")).toHaveLength(0);
    } finally { executeFixtureDDL("DROP TRIGGER users_it_fail_audit;"); }
  });
});
