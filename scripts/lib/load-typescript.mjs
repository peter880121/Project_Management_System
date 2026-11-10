import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// Same runtime adapter as the existing document worker. Does not bypass typecheck.
export function typescriptRequire(root) {
  const require = createRequire(import.meta.url);
  require.extensions[".ts"] = (module, filename) => {
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      transformers: { before: [context => source => {
        const visit = node => ts.isStringLiteral(node) && node.text.startsWith("@/")
          ? ts.factory.createStringLiteral(resolve(root, "src", node.text.slice(2)).replaceAll("\\", "/"))
          : ts.visitEachChild(node, visit, context);
        return ts.visitNode(source, visit);
      }] },
    });
    module._compile(output.outputText, filename);
  };
  return require;
}
