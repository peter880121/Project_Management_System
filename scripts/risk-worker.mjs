// Same runtime TS toolchain as the document worker; typecheck remains required.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import ts from "typescript";
config({ quiet: true });
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, filename) => {
  let context;
  const visit = (node) => ts.isStringLiteral(node) && node.text.startsWith("@/")
    ? ts.factory.createStringLiteral(resolve(root, "src", node.text.slice(2)).replaceAll("\\", "/"))
    : ts.visitEachChild(node, visit, context);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, transformers: { before: [(ctx) => { context = ctx; return (source) => ts.visitEachChild(source, visit, context); }] } });
  module._compile(output.outputText, filename);
};
const abort = new AbortController();
process.once("SIGINT", () => abort.abort()); process.once("SIGTERM", () => abort.abort());
await require(resolve(root, "src/modules/ai/risk/worker.ts")).runRiskWorker(process.argv.includes("--once"), abort.signal);
