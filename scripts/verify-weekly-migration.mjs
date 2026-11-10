import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const url = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^medpm_(demo|dev|test)_/.test(url.pathname.slice(1))) throw new Error("Explicit local development/demo database required");
const db = new PrismaClient();
async function counts() {
  return Object.fromEntries(await Promise.all(["project", "task", "requirement", "document", "deliverable", "meetingRecord", "auditLog", "user"].map(async name => [name, await db[name].count()])));
}
try {
  const before = await counts();
  if (process.argv.includes("--apply")) execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: process.env, stdio: "pipe", windowsHide: true });
  const after = await counts();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Existing data counts changed; review immediately");
  mkdirSync("output/weekly-reports", { recursive: true });
  writeFileSync("output/weekly-reports/migration-verification.json", JSON.stringify({ applied: process.argv.includes("--apply"), before, after, verifiedAt: new Date().toISOString() }, null, 2));
  console.log("Weekly report migration verified; existing business and audit row counts preserved");
} finally { await db.$disconnect(); }
