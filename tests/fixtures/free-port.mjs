import { createServer } from "node:net";
import { randomInt } from "node:crypto";
// Bind-test a high port. Windows can assign port 1719 for listen(0), which
// Node fetch and Chromium reject as an unsafe port even though listening works.
export async function freeLocalPort() {
  for (let attempt = 0; attempt < 32; attempt++) {
    const server = createServer();
    try {
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(randomInt(20000, 60000), "127.0.0.1", resolve); });
      const port = server.address().port;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      return port;
    } catch (error) {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      if (!["EADDRINUSE", "EACCES"].includes(error.code)) throw error;
    }
  }
  throw new Error("Unable to reserve a browser-safe local test port");
}
