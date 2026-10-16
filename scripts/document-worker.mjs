// Runtime TS loader for the existing toolchain; pnpm typecheck remains the required static check.
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
  const transform = () => (source) => ts.visitEachChild(source, function visit(node) {
    if (ts.isStringLiteral(node) && node.text.startsWith("@/")) return ts.factory.createStringLiteral(resolve(root, "src", node.text.slice(2)).replaceAll("\\", "/"));
    return ts.visitEachChild(node, visit, context);
  }, context);
  let context;
  const output = ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, transformers: { before: [(ctx) => { context = ctx; return transform(); }] } });
  module._compile(output.outputText, filename);
};
const abort = new AbortController();
process.once("SIGINT", () => abort.abort()); process.once("SIGTERM", () => abort.abort());
await require(resolve(root, "src/modules/documents/parse-worker.ts")).runDocumentWorker(process.argv.includes("--once"), abort.signal);
