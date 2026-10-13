import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "@/modules/auth/password";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { verifyDatabaseSessionCredential } from "@/modules/auth/session-token";

const inviteCode = "integration-test-invite-code";
const signingSecret = "auth-login-integration-session-secret-32-bytes";
const activeUserId = "00000000-0000-4000-8000-0000000000a1";
const pendingUserId = "00000000-0000-4000-8000-0000000000a2";
const disabledUserId = "00000000-0000-4000-8000-0000000000a3";
const activeEmail = "active-login@example.test";
const databaseName = `medpm_auth_login_it_${randomUUID().replaceAll("-", "")}`;
const sourceDatabaseUrl = process.env.DATABASE_URL;
const rootPassword = process.env.MYSQL_ROOT_PASSWORD;
if (!sourceDatabaseUrl || !rootPassword) {
  throw new Error("Auth login integration tests require local DATABASE_URL and MYSQL_ROOT_PASSWORD from .env");
}

const sourceUrl = new URL(sourceDatabaseUrl);
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(sourceUrl.hostname)) {
  throw new Error("Auth login integration tests are restricted to a local MySQL server");
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
const port = 4418;
const endpoint = `http://127.0.0.1:${port}/api/auth/login`;
let server: ChildProcess | undefined;
let serverOutput = "";

function runMigrations() {
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl.toString() },
    stdio: "pipe",
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

async function resetMutableFixtureData() {
  await withDatabase(async (db) => {
    await db.session.deleteMany({ where: { userId: { in: [activeUserId, pendingUserId, disabledUserId] } } });
    await db.user.updateMany({
      where: { id: { in: [activeUserId, pendingUserId, disabledUserId] } },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: null },
    });
    await db.user.update({ where: { id: activeUserId }, data: { email: activeEmail, status: "ACTIVE" } });
    await db.user.update({ where: { id: pendingUserId }, data: { email: "auth-login-pending@example.test", status: "PENDING" } });
    await db.user.update({ where: { id: disabledUserId }, data: { email: "auth-login-disabled@example.test", status: "DISABLED" } });
  });
}

async function setActiveFixtureEmail(email: string) {
  await withDatabase((db) => db.user.update({ where: { id: activeUserId }, data: { email } }));
}

function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

async function countRecentAudit(input: { action: string; actorId: string; email: string; testStart: Date }) {
  return withDatabase(async (db) => {
    const rows = await db.auditLog.findMany({
      where: { action: input.action, actorId: input.actorId, createdAt: { gte: input.testStart } },
      select: { after: true },
    });
    return rows.filter((row) => {
      const after = row.after;
      return typeof after === "object" && after !== null && !Array.isArray(after) && after.targetEmail === maskEmail(input.email);
    }).length;
  });
}

async function postLogin(email: string, password: string) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.31", "user-agent": "auth-login-integration" },
    body: JSON.stringify({ email, password }),
  });
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next login test server exited early. Output:\n${serverOutput}`);
    }
    try {
      const response = await fetch(endpoint, { method: "GET" });
      if (response.status === 405) return;
    } catch {
      // The server is still starting.
    }
    await delay(500);
  }
  throw new Error(`Next login test server did not become ready. Output:\n${serverOutput}`);
}

describe.sequential("POST /api/auth/login over HTTP with real MySQL", () => {
  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    runMigrations();
    const passwordHash = await hashPassword("Password123");
    await withDatabase(async (db) => {
      await db.user.createMany({ data: [
        { id: SYSTEM_USER_ID, email: "auth-service@medpm.local", name: "Authentication system", role: "MEMBER", status: "DISABLED", isSystem: true },
        { id: activeUserId, email: activeEmail, name: "Synthetic Active User", role: "PM", status: "ACTIVE", passwordHash },
        { id: pendingUserId, email: "auth-login-pending@example.test", name: "Synthetic Pending User", role: "MEMBER", status: "PENDING", passwordHash },
        { id: disabledUserId, email: "auth-login-disabled@example.test", name: "Synthetic Disabled User", role: "MEMBER", status: "DISABLED", passwordHash },
      ] });
    });
    server = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "-p", String(port)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: testDatabaseUrl.toString(),
        REGISTRATION_INVITE_CODE: inviteCode,
        SESSION_SECRET: signingSecret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-8000); };
    server.stdout?.on("data", collect);
    server.stderr?.on("data", collect);
    await waitForServer();
  }, 120_000);

  afterEach(async () => {
    // Keep immutable AuditLog rows and their actor users; reset only mutable fixture state.
    await resetMutableFixtureData();
  });

  afterAll(async () => {
    server?.kill();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await admin.$disconnect();
  });

  it("creates a database Session and exactly one LOGIN_SUCCESS audit row", async () => {
    const t1 = new Date(Date.now() - 1000);
    const response = await postLogin(activeEmail, "Password123");
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ user: { id: activeUserId, email: activeEmail, name: "Synthetic Active User", role: "PM" } });
    expect(payload.user).not.toHaveProperty("passwordHash");

    const setCookie = response.headers.get("set-cookie") ?? "";
    const cookieValue = /medpm_session=([^;]+)/.exec(setCookie)?.[1];
    expect(cookieValue).toBeTruthy();
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    const claims = verifyDatabaseSessionCredential(decodeURIComponent(cookieValue!), signingSecret);
    expect(claims).not.toBeNull();

    await withDatabase(async (db) => {
      const session = await db.session.findUniqueOrThrow({ where: { id: claims!.sessionId } });
      expect(session.userId).toBe(activeUserId);
      expect(session.tokenHash).toBe(claims!.tokenHash);
      expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(session.revokedAt).toBeNull();
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
      const user = await db.user.findUniqueOrThrow({ where: { id: activeUserId } });
      expect(user.failedLoginCount).toBe(0);
      expect(user.lastLoginAt).not.toBeNull();
      expect(await countRecentAudit({ action: "LOGIN_SUCCESS", actorId: activeUserId, email: activeEmail, testStart: t1 })).toBe(1);
      expect(await countRecentAudit({ action: "LOGIN_FAILED", actorId: activeUserId, email: activeEmail, testStart: t1 })).toBe(0);
    });
  }, 30_000);

  it("increments the failure counter and writes exactly one LOGIN_FAILED audit for a wrong password", async () => {
    const email = "wrong-password@example.test";
    await setActiveFixtureEmail(email);
    const testStart = new Date(Date.now() - 1000);
    const response = await postLogin(email, "WrongPassword123");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "邮箱或密码错误" });
    await withDatabase(async (db) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: activeUserId } });
      expect(user.failedLoginCount).toBe(1);
      expect(user.lockedUntil).toBeNull();
    });
    expect(await countRecentAudit({ action: "LOGIN_FAILED", actorId: activeUserId, email, testStart })).toBe(1);
  });

  it("locks on the fifth failure and does not extend the lock on the sixth request", async () => {
    const email = "lock-boundary@example.test";
    await setActiveFixtureEmail(email);
    const auditStart = new Date(Date.now() - 1000);
    let response: Response | undefined;
    let fifthRequestStart: Date | undefined;
    let fifthRequestEnd: Date | undefined;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      if (attempt === 5) fifthRequestStart = new Date();
      response = await postLogin(email, "WrongPassword123");
      if (attempt === 5) fifthRequestEnd = new Date();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "邮箱或密码错误" });
    }
    expect(await countRecentAudit({ action: "LOGIN_FAILED", actorId: activeUserId, email, testStart: auditStart })).toBe(5);
    let lockedUntil: Date | null = null;
    await withDatabase(async (db) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: activeUserId } });
      expect(user.failedLoginCount).toBe(5);
      lockedUntil = user.lockedUntil;
      expect(lockedUntil).not.toBeNull();
      expect(lockedUntil!.getTime()).toBeGreaterThanOrEqual(fifthRequestStart!.getTime() + 15 * 60_000 - 1000);
      expect(lockedUntil!.getTime()).toBeLessThanOrEqual(fifthRequestEnd!.getTime() + 15 * 60_000 + 1000);
    });

    response = await postLogin(email, "WrongPassword123");
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({ error: "账号已锁定，请 15 分钟后重试" });
    await withDatabase(async (db) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: activeUserId } });
      expect(user.failedLoginCount).toBe(5);
      expect(user.lockedUntil?.getTime()).toBe(lockedUntil?.getTime());
    });
    expect(await countRecentAudit({ action: "LOGIN_FAILED", actorId: activeUserId, email, testStart: auditStart })).toBe(6);
  }, 30_000);

  it("clears an expired lock and counter after a successful login", async () => {
    const email = "expired-success@example.test";
    await setActiveFixtureEmail(email);
    await withDatabase((db) => db.user.update({
      where: { id: activeUserId },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() - 60_000) },
    }));
    const testStart = new Date(Date.now() - 1000);
    const response = await postLogin(email, "Password123");
    expect(response.status).toBe(200);
    await withDatabase(async (db) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: activeUserId } });
      expect(user.failedLoginCount).toBe(0);
      expect(user.lockedUntil).toBeNull();
      expect(user.lastLoginAt).not.toBeNull();
    });
    expect(await countRecentAudit({ action: "LOGIN_SUCCESS", actorId: activeUserId, email, testStart })).toBe(1);
    expect(await countRecentAudit({ action: "LOGIN_FAILED", actorId: activeUserId, email, testStart })).toBe(0);
  });

  it("clears an expired lock before counting a wrong password as failure one", async () => {
    const email = "expired-wrong-password@example.test";
    await setActiveFixtureEmail(email);
    await withDatabase((db) => db.user.update({
      where: { id: activeUserId },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() - 60_000) },
    }));
    const testStart = new Date(Date.now() - 1000);
    const response = await postLogin(email, "WrongPassword123");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "邮箱或密码错误" });
    await withDatabase(async (db) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: activeUserId } });
      expect(user.failedLoginCount).toBe(1);
      expect(user.lockedUntil).toBeNull();
    });
    expect(await countRecentAudit({ action: "LOGIN_FAILED", actorId: activeUserId, email, testStart })).toBe(1);
  });

  it("returns the activation message for PENDING without counting a password failure", async () => {
    const email = "auth-login-pending@example.test";
    const testStart = new Date(Date.now() - 1000);
    const response = await postLogin(email, "Password123");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "等待管理员激活" });
    await withDatabase(async (db) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: pendingUserId } });
      expect(user.failedLoginCount).toBe(0);
      expect(user.lockedUntil).toBeNull();
      expect(await db.session.count({ where: { userId: pendingUserId } })).toBe(0);
    });
    expect(await countRecentAudit({ action: "LOGIN_FAILED", actorId: pendingUserId, email, testStart })).toBe(1);
  });

  it("returns the generic error for DISABLED without counting a password failure", async () => {
    const email = "auth-login-disabled@example.test";
    const testStart = new Date(Date.now() - 1000);
    const response = await postLogin(email, "Password123");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "邮箱或密码错误" });
    await withDatabase(async (db) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: disabledUserId } });
      expect(user.failedLoginCount).toBe(0);
      expect(user.lockedUntil).toBeNull();
      expect(await db.session.count({ where: { userId: disabledUserId } })).toBe(0);
    });
    expect(await countRecentAudit({ action: "LOGIN_FAILED", actorId: disabledUserId, email, testStart })).toBe(1);
  });

  it("returns the generic error for an unknown email and audits it as a system event", async () => {
    const email = "auth-login-unknown@example.test";
    const testStart = new Date(Date.now() - 1000);
    const userCount = await withDatabase((db) => db.user.count());
    const response = await postLogin(email, "Password123");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "邮箱或密码错误" });
    await withDatabase(async (db) => {
      expect(await db.user.count()).toBe(userCount);
      expect(await db.session.count()).toBe(0);
      const audits = await db.auditLog.findMany({
        where: { action: "LOGIN_FAILED", actorId: SYSTEM_USER_ID, createdAt: { gte: testStart } },
        select: { after: true },
      });
      const matching = audits.filter((row) => {
        const after = row.after;
        return typeof after === "object" && after !== null && !Array.isArray(after) && after.targetEmail === maskEmail(email);
      });
      expect(matching).toHaveLength(1);
    });
  });
});
