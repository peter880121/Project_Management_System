import "dotenv/config";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Reversible demo preparation: never delete a source database, row, object or audit.
if (process.env.NODE_ENV === "production") throw new Error("Demo preparation is development-only");
if (!process.argv.includes("--apply")) throw new Error("Use --apply to create a fresh demo database and switch local .env");
if (!process.env.MYSQL_ROOT_PASSWORD) throw new Error("Local MySQL administrator credentials are required");
const sourceUrl = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(sourceUrl.hostname)) throw new Error("Only local MySQL is allowed");
const username = decodeURIComponent(sourceUrl.username);
if (!/^[a-zA-Z0-9_-]+$/.test(username)) throw new Error("Unsupported local application account name");
const name = `medpm_demo_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(3).toString("hex")}`;
if (!/^medpm_demo_\d{8}_[a-f0-9]{6}$/.test(name)) throw new Error("Unexpected target database identifier");
const adminUrl = new URL(sourceUrl); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
const targetUrl = new URL(sourceUrl); targetUrl.pathname = `/${name}`;
const source = new PrismaClient({ datasources: { db: { url: sourceUrl.toString() } } });
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const target = new PrismaClient({ datasources: { db: { url: targetUrl.toString() } } });
const environment = readFileSync(".env", "utf8");
if (!/^DATABASE_URL=/m.test(environment)) throw new Error("Expected DATABASE_URL in local .env");
const backup = `.env.before-demo-${name}`;

try {
  const sourceCounts = { projects: await source.project.count(), users: await source.user.count(), audits: await source.auditLog.count() };
  const demoIds = [1, 2, 3, 4, 5, 6, 240].map(value => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`);
  const passwords = await source.user.findMany({ where: { id: { in: demoIds } }, select: { id: true, passwordHash: true } });
  const accounts = await admin.$queryRaw`SELECT Host AS host FROM mysql.user WHERE User = ${username}`;
  if (!accounts.length || accounts.some(row => !/^[a-zA-Z0-9_.%:-]+$/.test(row.host))) throw new Error("Unexpected application account grants");
  copyFileSync(".env", backup);
  // Identifiers cannot be SQL parameters. Both schema and account identifiers are strictly allowlisted above.
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const { host } of accounts) await admin.$executeRawUnsafe(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${username}'@'${host}'`);
  const env = { ...process.env, NODE_ENV: "development", DATABASE_URL: targetUrl.toString(), LOCAL_DEV_SEED_PASSWORD: process.env.LOCAL_DEV_SEED_PASSWORD || randomBytes(24).toString("base64url") };
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, stdio: "pipe", windowsHide: true });
  execFileSync(process.execPath, ["prisma/seed.mjs"], { env, stdio: "pipe", windowsHide: true });
  await target.$transaction(async tx => {
    for (const row of passwords) if (row.passwordHash) await tx.user.update({ where: { id: row.id }, data: { passwordHash: row.passwordHash } });
  });
  const counts = { projects: await target.project.count(), users: await target.user.count(), tasks: await target.task.count(), audits: await target.auditLog.count(), sessions: await target.session.count() };
  if (counts.projects !== 3 || counts.users !== 7 || counts.tasks !== 24 || counts.sessions !== 0) throw new Error("Demo dataset verification failed; .env was not switched");
  if (await source.auditLog.count() !== sourceCounts.audits) throw new Error("Source changed during preparation; .env was not switched");
  writeFileSync(".env", environment.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${targetUrl.toString()}`), "utf8");
  console.log(JSON.stringify({ sourceDatabase: sourceUrl.pathname.slice(1), demoDatabase: name, sourceCounts, demoCounts: counts, environmentBackup: backup, previousPasswordsPreserved: true }, null, 2));
} catch {
  console.error("Demo preparation failed. Source data was not deleted. Check local MySQL permissions and migrations; the environment backup is retained if created.");
  process.exitCode = 1;
} finally { await Promise.all([source.$disconnect(), admin.$disconnect(), target.$disconnect()]); }
