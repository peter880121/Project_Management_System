import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { createGzip, createGunzip } from "node:zlib";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { once } from "node:events";
import { resolve } from "node:path";

const apply = process.argv.includes("--apply");
if (process.argv.some(arg => arg.startsWith("--") && arg !== "--apply" && !arg.startsWith("--reuse-archive="))) throw new Error("Supported options: --apply --reuse-archive=...");
const source = new URL(process.env.DATABASE_URL || "");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Local development only");
if (!process.env.MYSQL_ROOT_PASSWORD) throw new Error("Local MySQL backup credentials required");
const rootUrl = new URL(source); rootUrl.username = "root"; rootUrl.password = process.env.MYSQL_ROOT_PASSWORD; rootUrl.pathname = "/mysql";
const admin = new PrismaClient({ datasources: { db: { url: rootUrl.toString() } } });
const app = new PrismaClient();
const pattern = /^medpm_test_ia_\d{13}_[a-f0-9]{6}$/;
const workspace = resolve(".");
const stamp = new Date().toISOString().replace(/[-:.]/g, "");
const folder = resolve(".maintenance", `database-cleanup-${stamp}`);
if (!folder.startsWith(`${workspace}\\`) && !folder.startsWith(`${workspace}/`)) throw new Error("Archive must stay within workspace");
const env = { ...process.env, MYSQL_PWD: process.env.MYSQL_ROOT_PASSWORD };
const connection = [`--host=${source.hostname}`, `--port=${source.port || "3306"}`, "--user=root", "--protocol=TCP"];
async function childResult(child) {
  let stderr = ""; child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
  const [code] = await once(child, "exit");
  // Never print raw command stderr: connection diagnostics could contain secrets.
  return { code, stderr: stderr.replaceAll(process.env.MYSQL_ROOT_PASSWORD, "[REDACTED]") };
}
async function liveCounts() {
  return { projects: await app.project.count(), tasks: await app.task.count(), users: await app.user.count(), audits: await app.auditLog.count(), weeklyReports: await app.weeklyReport.count() };
}
try {
  const rows = await admin.$queryRaw`SELECT TABLE_SCHEMA name,COUNT(*) tablesCount,COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA REGEXP '^medpm_test_ia_[0-9]{13}_[a-f0-9]{6}$' GROUP BY TABLE_SCHEMA ORDER BY TABLE_SCHEMA`;
  const connections = await admin.$queryRaw`SELECT DB dbName,COUNT(*) count FROM information_schema.PROCESSLIST WHERE DB IS NOT NULL GROUP BY DB`;
  const busy = new Set(connections.map(row => row.dbName));
  const targets = rows.filter(row => pattern.test(row.name) && row.name !== source.pathname.slice(1) && !busy.has(row.name));
  const before = await liveCounts();
  console.log(JSON.stringify({ mode: apply ? "APPLY" : "PREVIEW", isolatedSchemas: targets.length, estimatedMiB: Math.round(targets.reduce((n, row) => n + Number(row.bytes), 0) / 1048576), skippedBusySchemas: rows.length - targets.length, activeCounts: before, auditArchiveRequired: true }));
  if (!apply || !targets.length) process.exitCode = 0;
  else {
    await mkdir(folder, { recursive: true });
    const reuse = process.argv.find(arg => arg.startsWith("--reuse-archive="))?.slice("--reuse-archive=".length);
    const backup = resolve(reuse ?? resolve(folder, "isolated-test-databases.sql.gz"));
    if (!backup.startsWith(resolve(workspace, ".maintenance") + "\\")) throw new Error("Archive outside maintenance directory");
    if (!reuse) {
      const dump = spawn("mysqldump.exe", [...connection, "--single-transaction", "--routines", "--triggers", "--events", "--hex-blob", "--set-gtid-purged=OFF", "--no-tablespaces", "--databases", ...targets.map(row => row.name)], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const exited = childResult(dump);
      const [, result] = await Promise.all([pipeline(dump.stdout, createGzip({ level: 9 }), createWriteStream(backup, { flags: "wx" })), exited]);
      if (result.code !== 0) { await writeFile(resolve(folder, "dump-error.txt"), result.stderr); throw new Error("Database backup failed; cleanup refused"); }
    }
    const hash = createHash("sha256"); const seen = new Set(); const decoder = new StringDecoder("utf8"); let carry = ""; let current = "";
    const sample = targets.at(-1).name;
    const restoredName = `medpm_test_restore_${Date.now()}`;
    const restore = spawn("mysql.exe", [...connection, "--default-character-set=utf8mb4"], { env, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    const restored = childResult(restore);
    let restoreBroken = false;
    restore.stdin.on("error", () => { restoreBroken = true; });
    const pending = [];
    // MySQL 8.0.26 may include a trailing delimiter inside SHOW CREATE TRIGGER.
    // mysqldump wraps that delimiter in an executable comment; normalize only
    // this outer DDL delimiter, leaving data and trigger body statements intact.
    const restoreLine = line => line.split(`\`${sample}\``).join(`\`${restoredName}\``).replace(/;\s*(\*\/;;\r?\n?)$/, " $1");
    // Verify every byte can be decompressed and restore the last complete schema
    // under an explicit scratch name before removing any original schema.
    const stream = createReadStream(backup).pipe(createGunzip());
    for await (const chunk of stream) {
      hash.update(chunk); carry += decoder.write(chunk);
      let index;
      while ((index = carry.indexOf("\n")) >= 0) {
        const line = carry.slice(0, index + 1); carry = carry.slice(index + 1);
        const marker = /^-- Current Database: `([^`]+)`/.exec(line);
        if (marker) { current = marker[1]; seen.add(current); }
        if (!current || current === sample) pending.push(restoreLine(line));
      }
      if (pending.length) { const text = pending.splice(0).join(""); if (!restoreBroken && !restore.stdin.destroyed) restore.stdin.write(text); }
    }
    carry += decoder.end(); if (!restoreBroken && !restore.stdin.destroyed && current === sample && carry) restore.stdin.write(restoreLine(carry));
    if (!restore.stdin.destroyed) restore.stdin.end(); const restoreResult = await restored;
    if (restoreResult.code !== 0) { await writeFile(resolve(folder, "restore-error.txt"), restoreResult.stderr); throw new Error("Archive restore failed; no original schemas removed; see private restore diagnostic"); }
    if (targets.some(row => !seen.has(row.name))) throw new Error("Archive does not contain every selected schema; cleanup refused");
    const originalAudit = await admin.$queryRawUnsafe(`SELECT COUNT(*) count FROM \`${sample}\`.AuditLog`);
    const restoredAudit = await admin.$queryRawUnsafe(`SELECT COUNT(*) count FROM \`${restoredName}\`.AuditLog`);
    const originalTables = await admin.$queryRaw`SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=${sample}`;
    const restoredTables = await admin.$queryRaw`SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=${restoredName}`;
    if (originalAudit[0].count !== restoredAudit[0].count || originalTables[0].count !== restoredTables[0].count) throw new Error("Restore verification failed; cleanup refused");
    const manifest = { createdAt: new Date().toISOString(), operator: process.env.USERNAME || "local-operator", archive: backup, archiveBytes: (await stat(backup)).size, uncompressedSha256: hash.digest("hex"), restoreVerified: { sample, tables: Number(restoredTables[0].count), audits: Number(restoredAudit[0].count) }, activeCountsBefore: before, targets: targets.map(row => row.name), removed: [] };
    const manifestFile = resolve(folder, "manifest.json");
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    await admin.$executeRawUnsafe(`DROP DATABASE \`${restoredName}\``);
    for (const { name } of targets) {
      if (!pattern.test(name) || name === source.pathname.slice(1)) throw new Error("Unsafe target rejected");
      const sessions = await admin.$queryRaw`SELECT COUNT(*) count FROM information_schema.PROCESSLIST WHERE DB=${name}`;
      if (Number(sessions[0].count)) continue;
      await admin.$executeRawUnsafe(`DROP DATABASE \`${name}\``);
      manifest.removed.push(name);
      await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    }
    const after = await liveCounts(); manifest.activeCountsAfter = after;
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Active database counts changed concurrently; inspect manifest");
    console.log(JSON.stringify({ removedSchemas: manifest.removed.length, archiveBytes: manifest.archiveBytes, restoreVerified: true, activeCountsPreserved: true, manifest: manifestFile }));
  }
} finally { await app.$disconnect(); await admin.$disconnect(); }
