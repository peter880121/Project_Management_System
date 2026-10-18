import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { startServer } = require("next/dist/server/lib/start-server");
// A real entry file keeps forked compilation workers free of inherited `node -e` arguments.
await startServer({ dir: process.cwd(), isDev: true, hostname: "127.0.0.1", port: Number(process.env.E2E_APP_PORT || 4514), allowRetry: false });
