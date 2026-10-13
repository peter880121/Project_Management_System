import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SYSTEM_USER_ID } from "@/lib/system-user";

const inviteCode = "integration-test-invite-code";
const databaseName = `medpm_auth_it_${randomUUID().replaceAll("-", "")}`;
const sourceDatabaseUrl = process.env.DATABASE_URL;
const rootPassword = process.env.MYSQL_ROOT_PASSWORD;
if (!sourceDatabaseUrl || !rootPassword) {
  throw new Error("Auth HTTP integration tests require local DATABASE_URL and MYSQL_ROOT_PASSWORD from .env");
}

const sourceUrl = new URL(sourceDatabaseUrl);
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(sourceUrl.hostname)) {
  throw new Error("Auth HTTP integration tests are restricted to a local MySQL server");
}
const adminUrl = new URL(sourceUrl);
adminUrl.username = "root";
adminUrl.password = rootPassword;
adminUrl.pathname = "/mysql";
const testDatabaseUrl = new URL(sourceUrl);
testDatabaseUrl.pathname = `/${databaseName}`;

const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const nextCli = "node_modules/next/dist/bin/next";
const prismaCli = "node_modules/prisma/build/index.js";
const port = 4417;
const endpoint = `http://127.0.0.1:${port}/api/auth/register`;
let server: ChildProcess | undefined;
let serverOutput = "";

function runMigrations() {
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl.toString() },
    stdio: "pipe",
  });
}

async function createSystemUser() {
  const db = new PrismaClient({ datasources: { db: { url: testDatabaseUrl.toString() } } });
  try {
    await db.user.create({ data: {
      id: SYSTEM_USER_ID,
      email: "auth-service@medpm.local",
      name: "Authentication system",
      role: "MEMBER",
      status: "DISABLED",
      isSystem: true,
    } });
  } finally {
    await db.$disconnect();
  }
}

async function resetIsolatedDatabase() {
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${databaseName}\``);
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  runMigrations();
  await createSystemUser();
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next test server exited early. Output:\n${serverOutput}`);
    }
    try {
      const response = await fetch(endpoint, { method: "GET" });
      if (response.status === 405) return;
    } catch {
      // The server is still starting.
    }
    await delay(500);
  }
  throw new Error(`Next test server did not become ready. Output:\n${serverOutput}`);
}

async function post(body: unknown) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.25", "user-agent": "auth-integration-test" },
    body: JSON.stringify(body),
  });
}

async function withDatabase<T>(run: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient({ datasources: { db: { url: testDatabaseUrl.toString() } } });
  try {
    return await run(db);
  } finally {
    await db.$disconnect();
  }
}

describe.sequential("POST /api/auth/register over HTTP with real MySQL", () => {
  beforeAll(async () => {
    await resetIsolatedDatabase();
    server = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "-p", String(port)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: testDatabaseUrl.toString(),
        REGISTRATION_INVITE_CODE: inviteCode,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-8000); };
    server.stdout?.on("data", collect);
    server.stderr?.on("data", collect);
    await waitForServer();
  }, 120_000);

  afterEach(async () => {
    // AuditLog is immutable; discard and recreate this isolated per-suite schema after each case.
    await resetIsolatedDatabase();
  }, 120_000);

  afterAll(async () => {
    server?.kill();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await admin.$disconnect();
  });

  it("creates a PENDING user and USER_REGISTERED audit without an invite", async () => {
    const response = await post({ name: "Pending Test User", email: "pending-auth-it@example.test", password: "Password123" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ message: "注册成功，等待管理员激活", status: "PENDING" });
    await withDatabase(async (db) => {
      const user = await db.user.findUniqueOrThrow({ where: { email: "pending-auth-it@example.test" } });
      expect(user.status).toBe("PENDING");
      expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect(await db.auditLog.count({ where: { actorId: user.id, action: "USER_REGISTERED", entityId: user.id } })).toBe(1);
      expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  it("creates an ACTIVE user with the configured invite", async () => {
    const response = await post({ name: "Active Test User", email: "active-auth-it@example.test", password: "Password123", inviteCode });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ message: "注册成功，请登录", status: "ACTIVE" });
    await withDatabase(async (db) => {
      const user = await db.user.findUniqueOrThrow({ where: { email: "active-auth-it@example.test" } });
      expect(user.status).toBe("ACTIVE");
      expect(await db.auditLog.count({ where: { actorId: user.id, action: "USER_REGISTERED" } })).toBe(1);
    });
  });

  it("returns 409 for a duplicate email and commits one rejection audit row", async () => {
    await withDatabase((db) => db.user.create({ data: {
      email: "duplicate-auth-it@example.test",
      name: "Existing Synthetic User",
      status: "PENDING",
    } }));
    const beforeCount = await withDatabase((db) => db.user.count());
    const response = await post({ name: "Duplicate Test User", email: "duplicate-auth-it@example.test", password: "Password123" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "无法完成注册" });
    await withDatabase(async (db) => {
      expect(await db.user.count()).toBe(beforeCount);
      const audits = await db.auditLog.findMany({ where: { action: "USER_REGISTRATION_REJECTED", actorId: SYSTEM_USER_ID } });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.after).toEqual({ email: "d***@example.test", reason: "duplicate_email" });
      expect(audits[0]?.ip).toBe("192.0.2.25");
      expect(audits[0]?.userAgent).toBe("auth-integration-test");
    });
  });

  it("returns 400 and creates no row for a password over 72 UTF-8 bytes", async () => {
    const beforeCount = await withDatabase((db) => db.user.count());
    const response = await post({ name: "Long Password User", email: "long-auth-it@example.test", password: `A1${"中".repeat(24)}` });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "密码不能超过 72 字节" });
    await withDatabase(async (db) => {
      expect(await db.user.count()).toBe(beforeCount);
      expect(await db.auditLog.count()).toBe(0);
    });
  });

  it("returns 400 and creates no row for a password that fails format rules", async () => {
    const beforeCount = await withDatabase((db) => db.user.count());
    const response = await post({ name: "Bad Password User", email: "bad-password-auth-it@example.test", password: "allletters" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "密码至少 8 位，且必须包含字母和数字" });
    await withDatabase(async (db) => {
      expect(await db.user.count()).toBe(beforeCount);
      expect(await db.auditLog.count()).toBe(0);
    });
  });

  it("returns 400 and creates no row for an invalid invite", async () => {
    const beforeCount = await withDatabase((db) => db.user.count());
    const response = await post({ name: "Invalid Invite User", email: "bad-invite-auth-it@example.test", password: "Password123", inviteCode: "wrong-code" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "邀请码无效" });
    await withDatabase(async (db) => {
      expect(await db.user.count()).toBe(beforeCount);
      expect(await db.auditLog.count()).toBe(0);
    });
  });
});
