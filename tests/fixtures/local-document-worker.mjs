import "dotenv/config";
import { resolve } from "node:path";
import { typescriptRequire } from "../../scripts/lib/load-typescript.mjs";
if (!/^medpm_test_ia_/.test(new URL(process.env.DATABASE_URL).pathname.slice(1))) throw new Error("Local parser fixture requires an isolated acceptance database");
const require = typescriptRequire(resolve("."));
const db = require(resolve("src/lib/prisma.ts")).prisma;
try {
  const first = await db.documentParseJob.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] }, nextRunAt: { lte: new Date() } }, orderBy: [{ nextRunAt: "asc" }, { id: "asc" }] });
  if (!first || first.phase !== "LOCAL") throw new Error("Expected a queued local parse; no cloud calls are permitted");
  await require(resolve("src/modules/documents/parse-worker.ts")).runParseWorkerTick();
  if ((await db.documentParseJob.findUniqueOrThrow({ where: { id: first.id } })).status !== "SUCCEEDED") throw new Error("Local parser did not succeed");
} finally { await db.$disconnect(); }
