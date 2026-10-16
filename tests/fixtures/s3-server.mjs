// Test-only S3 protocol fixture. Not a MinIO implementation; never use outside isolated tests.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
export function createS3Fixture() {
  const objects = new Map();
  let rejectWrites = false;
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://fixture");
      if (url.pathname === "/__fixture/fail-writes" && request.method === "POST") { rejectWrites = url.searchParams.get("enabled") === "true"; response.end("ok"); return; }
      if (url.searchParams.has("location")) { response.setHeader("Content-Type", "application/xml"); response.end('<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>'); return; }
      if (request.method === "PUT") {
        if (rejectWrites) { response.writeHead(503, { "Content-Type": "application/xml" }); response.end("<Error><Code>ServiceUnavailable</Code><Message>Synthetic write outage</Message></Error>"); return; }
        const chunks = []; let length = 0;
        for await (const part of request) { length += part.length; if (length > 21 * 1024 * 1024) throw new Error("Fixture body too large"); chunks.push(part); }
        const bytes = Buffer.concat(chunks); objects.set(url.pathname, bytes);
        response.setHeader("ETag", `"${createHash("md5").update(bytes).digest("hex")}"`); response.end(); return;
      }
      if (request.method === "DELETE") { objects.delete(url.pathname); response.writeHead(204); response.end(); return; }
      const bytes = objects.get(url.pathname);
      if (!bytes) { response.writeHead(404, { "Content-Type": "application/xml" }); response.end("<Error><Code>NoSuchKey</Code><Message>Synthetic object missing</Message></Error>"); return; }
      response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": bytes.length }); response.end(request.method === "HEAD" ? undefined : bytes);
    } catch { response.writeHead(500); response.end("Synthetic fixture failure"); }
  });
}
