import "dotenv/config";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { startAiStreamFixture } from "../tests/fixtures/ai-stream-server.mjs";

const fixture = await startAiStreamFixture();
const port = 4513; const baseURL = `http://127.0.0.1:${port}`;
const env = { ...process.env, AI_PROVIDER: "openai", AI_MODEL: "synthetic-stream", OPENAI_API_KEY: "synthetic-fixture-only", OPENAI_BASE_URL: `${fixture.url}/v1`, AI_STREAM_FIXTURE_URL: fixture.url, E2E_BASE_URL: baseURL, E2E_APP_PORT: String(port) };
const app = spawn(process.execPath, ["tests/fixtures/next-dev-server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let log = ""; const collect = chunk => { log = (log + chunk.toString()).slice(-4000); }; app.stdout.on("data", collect); app.stderr.on("data", collect);
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (app.exitCode !== null) throw new Error("Fixture application exited early");
    try { if ((await fetch(baseURL)).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  if (!ready) throw new Error(`Fixture application not ready: ${log}`);
  const test = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "e2e/ai-streaming.spec.ts", "e2e/meeting-ai-streaming.spec.ts", "--output=test-results/ai-streaming-run"], { env, stdio: "inherit", windowsHide: true });
  process.exitCode = await new Promise(resolve => test.on("exit", code => resolve(code ?? 1)));
} finally {
  // Direct server startup keeps cleanup within this fixture's single owned process.
  if (app.exitCode === null && app.signalCode === null) await new Promise(resolve => { app.once("exit", resolve); app.kill(); });
  await fixture.close();
}
