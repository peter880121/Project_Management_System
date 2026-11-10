import { freeLocalPort } from "../fixtures/free-port.mjs";
import "dotenv/config";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_USER_ID } from "@/lib/system-user";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { createSessionToken, verifyDatabaseSessionCredential } from "@/modules/auth/session-token";

const databaseName = `medpm_auth_session_it_${randomUUID().replaceAll("-", "")}`;
if (!process.env.DATABASE_URL || !process.env.MYSQL_ROOT_PASSWORD) {
  throw new Error("Session integration tests require local DATABASE_URL and MYSQL_ROOT_PASSWORD");
}
const sourceUrl = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(sourceUrl.hostname)) {
  throw new Error("Session integration tests require local MySQL");
}
const adminUrl = new URL(sourceUrl);
adminUrl.username = "root";
adminUrl.password = process.env.MYSQL_ROOT_PASSWORD;
adminUrl.pathname = "/mysql";
const databaseUrl = new URL(sourceUrl);
databaseUrl.pathname = `/${databaseName}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const db = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
const signingSecret = "session-http-integration-signing-secret-32-bytes";
const port = await freeLocalPort();
const baseURL = `http://127.0.0.1:${port}`;
const password = "OriginalPassword123";
const newPassword = "UpdatedPassword456";
let server: ChildProcess | undefined;
let serverOutput = "";
let originalHash: string;
let userId: string;
let email: string;
let testStart: Date;

async function http(path: string, method = "GET", cookie?: string, body?: unknown) {
  return fetch(`${baseURL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "user-agent": "session-http-integration",
      "x-forwarded-for": "192.0.2.41",
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function readCookie(response: Response) {
  const credential = /medpm_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  expect(credential).toBeTruthy();
  return `medpm_session=${credential!}`;
}

function claimsFor(cookie: string) {
  const claims = verifyDatabaseSessionCredential(decodeURIComponent(cookie.slice("medpm_session=".length)), signingSecret);
  expect(claims).not.toBeNull();
  return claims!;
}

function expectCookieCleared(response: Response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/medpm_session=;/);
  expect(setCookie).toMatch(/expires=Thu, 01 Jan 1970|Max-Age=0/i);
}

async function login(value = password) {
  const response = await http("/api/auth/login", "POST", undefined, { email, password: value });
  expect(response.status).toBe(200);
  return readCookie(response);
}

async function changePassword(cookie: string, currentPassword = password, nextPassword = newPassword) {
  return http("/api/users/me/password", "PATCH", cookie, { currentPassword, newPassword: nextPassword });
}

async function auditRows(action: string) {
  return db.auditLog.findMany({ where: { actorId: userId, action, createdAt: { gte: testStart } } });
}

async function snapshot() {
  return {
    user: await db.user.findUniqueOrThrow({ where: { id: userId } }),
    sessions: await db.session.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    audits: await db.auditLog.findMany({ where: { actorId: userId }, orderBy: { id: "asc" } }),
  };
}

describe.sequential("Session APIs over HTTP with real MySQL", () => {
  beforeAll(async () => {
    // The generated name contains only a fixed prefix and UUID hex; never use the source database for writes.
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: databaseUrl.toString() }, stdio: "pipe",
    });
    originalHash = await hashPassword(password);
    await db.$transaction((tx) => tx.user.create({ data: {
      id: SYSTEM_USER_ID, email: "system@medpm.local", name: "Synthetic system", role: "MEMBER", status: "DISABLED", isSystem: true,
    } }));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "-p", String(port)], {
      env: { ...process.env, NODE_ENV: "development", DATABASE_URL: databaseUrl.toString(), SESSION_SECRET: signingSecret },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-8000); };
    server.stdout?.on("data", collect);
    server.stderr?.on("data", collect);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`Test server exited: ${serverOutput}`);
      try {
        if ((await http("/api/auth/login")).status === 405) return;
      } catch { /* Server is starting. */ }
      await delay(300);
    }
    throw new Error(`Test server did not become ready: ${serverOutput}`);
  }, 120_000);

  beforeEach(async () => {
    userId = randomUUID();
    email = `session-${userId}@example.test`;
    testStart = new Date(Date.now() - 1000);
    await db.$transaction((tx) => tx.user.create({ data: {
      id: userId, email, name: "Synthetic session tester", role: "PM", status: "ACTIVE", passwordHash: originalHash,
    } }));
  });

  afterEach(async () => {
    // Immutable audit rows reference their actor: retain each synthetic user until the whole test database is dropped.
    await db.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: {
        passwordHash: originalHash, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null,
      } });
    });
  });

  afterAll(async () => {
    try {
      if (server && server.exitCode === null) {
        const exited = new Promise<void>((resolve) => server!.once("exit", () => resolve()));
        server.kill();
        await Promise.race([exited, delay(5000)]);
      }
    } finally {
      await db.$disconnect();
      try { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${databaseName}\``); }
      finally { await admin.$disconnect(); }
    }
  });

  it("logout revokes its Session and writes exactly one LOGOUT audit", async () => {
    const cookie = await login();
    const claims = claimsFor(cookie);
    const response = await http("/api/auth/logout", "POST", cookie);
    expect(response.status).toBe(200);
    expectCookieCleared(response);
    expect((await db.session.findUniqueOrThrow({ where: { id: claims.sessionId } })).revokedAt).not.toBeNull();
    const audits = await auditRows("LOGOUT");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityId: claims.sessionId, ip: "192.0.2.41", userAgent: "session-http-integration" });
    expect((await http("/api/auth/me", "GET", cookie)).status).toBe(401);
  });

  it("PM reads only active non-system options and cannot read the admin user list", async () => {
    const cookie = await login();
    const ids: string[] = [randomUUID(), randomUUID(), randomUUID()];
    await db.$transaction(async (tx) => {
      for (const [index, status] of (["ACTIVE", "PENDING", "DISABLED"] as const).entries()) {
        await tx.user.create({ data: { id: ids[index], email: `options-${ids[index]}@medpm.local`, name: "Synthetic Option", status, isSystem: index === 0 } });
      }
    });
    const response = await http("/api/users/options", "GET", cookie);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.some((item: { id: string }) => item.id === userId)).toBe(true);
    for (const item of data) expect(Object.keys(item).sort()).toEqual(["email", "id", "name"]);
    expect(data.some((item: { id: string }) => ids.includes(item.id))).toBe(false);
    expect((await http("/api/users", "GET", cookie)).status).toBe(403);
  });

  it("logout returns 200 and clears a cookie whose Session was already removed", async () => {
    const cookie = await login();
    await db.$transaction((tx) => tx.session.delete({ where: { id: claimsFor(cookie).sessionId } }));
    const response = await http("/api/auth/logout", "POST", cookie);
    expect(response.status).toBe(200);
    expectCookieCleared(response);
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await auditRows("LOGOUT")).toHaveLength(1);
  });

  it("me returns exactly the safe account fields", async () => {
    const cookie = await login();
    const response = await http("/api/auth/me", "GET", cookie);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Object.keys(payload.user).sort()).toEqual(["id", "email", "name", "role", "status", "lastLoginAt"].sort());
    expect(payload.user).toMatchObject({ id: userId, email, role: "PM", status: "ACTIVE" });
    expect(payload.user.lastLoginAt).toBeTruthy();
  });

  it("rejects the same valid legacy cookie on a protected route after the user is disabled", async () => {
    const legacyCookie = `medpm_session=${createSessionToken(userId, Date.now() + 60_000, signingSecret)}`;
    // This route relies on getCurrentUser alone; /auth/me has an additional status check.
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect((await http("/api/projects", "GET", legacyCookie)).status).toBe(200);

    await db.$transaction((tx) => tx.user.update({ where: { id: userId }, data: { status: "DISABLED" } }));

    const response = await http("/api/projects", "GET", legacyCookie);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });

  it("password change rotates its Session, revokes others and writes one audit", async () => {
    const current = await login();
    const other = await login();
    const currentClaims = claimsFor(current);
    const response = await changePassword(current);
    expect(response.status).toBe(200);
    const freshCookie = readCookie(response);
    const freshClaims = claimsFor(freshCookie);
    expect(freshClaims.sessionId).toBe(currentClaims.sessionId);
    expect(freshClaims.tokenHash).not.toBe(currentClaims.tokenHash);
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(newPassword, user.passwordHash!)).toBe(true);
    expect(await verifyPassword(password, user.passwordHash!)).toBe(false);
    const session = await db.session.findUniqueOrThrow({ where: { id: currentClaims.sessionId } });
    expect(session.tokenHash).toBe(freshClaims.tokenHash);
    expect(session.revokedAt).toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: claimsFor(other).sessionId } })).revokedAt).not.toBeNull();
    expect(await auditRows("PASSWORD_CHANGED")).toHaveLength(1);
    expect((await http("/api/auth/me", "GET", freshCookie)).status).toBe(200);
    expect((await http("/api/auth/me", "GET", current)).status).toBe(401);
  });

  it("wrong current password returns 400 without any database changes", async () => {
    const cookie = await login();
    const before = await snapshot();
    expect((await changePassword(cookie, "WrongPassword123")).status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it("a new password over 72 UTF-8 bytes returns 400 without writes", async () => {
    const cookie = await login();
    const before = await snapshot();
    expect((await changePassword(cookie, password, "中".repeat(24) + "A1")).status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it("the old password can no longer log in after password change", async () => {
    const cookie = await login();
    expect((await changePassword(cookie)).status).toBe(200);
    expect((await http("/api/auth/login", "POST", undefined, { email, password })).status).toBe(401);
  });

  it("other sessions' cookies return 401 after password change", async () => {
    const current = await login();
    const other = await login();
    expect((await http("/api/auth/me", "GET", other)).status).toBe(200);
    expect((await changePassword(current)).status).toBe(200);
    expect((await http("/api/auth/me", "GET", other)).status).toBe(401);
  });
});
