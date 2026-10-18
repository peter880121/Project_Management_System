import { Prisma } from "@prisma/client";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: vi.fn(async (callback: (tx: object) => Promise<void>) => callback({})) } }));
vi.mock("@/modules/audit/service", () => ({ recordAudit: vi.fn() }));
import { ProjectAccessError } from "@/modules/auth/project-access";
import { ProjectError } from "@/modules/projects/services";
import { generationId, generationResponse, safeStreamError } from "./response";
import { SseDecoder } from "./protocol";
const id = "00000000-0000-4000-8000-000000000001";
it.each([new ProjectAccessError("private role detail"), new ProjectError("private session detail", 401)])("maps permission errors to UNAUTHORIZED without exposing internals", error => {
  expect(safeStreamError(error)).toMatchObject({ event: "error", data: { code: "UNAUTHORIZED", retryable: false } });
  expect(JSON.stringify(safeStreamError(error))).not.toContain("private");
});
it("does not expose infrastructure errors and makes P2028 retryable", () => {
  const timeout = new Prisma.PrismaClientKnownRequestError("private SQL", { code: "P2028", clientVersion: "test" });
  expect(safeStreamError(timeout)).toMatchObject({ data: { code: "BUSY", status: 503 } });
  expect(JSON.stringify(safeStreamError(new Error("private key")))).not.toContain("private");
});
it("rejects invalid correlation IDs before starting a response", () => {
  expect(() => generationId(new Request("http://localhost", { headers: { "x-generation-id": "invalid" } }))).toThrow("ID 无效");
});
it("frames midstream errors as terminal SSE rather than JSON or unhandled rejection", async () => {
  const response = generationResponse(new Request("http://localhost"), { generationId: id, projectId: id, actorId: id }, async stream => {
    stream.emit({ event: "delta", data: { text: "合成预览" } }); throw new ProjectAccessError();
  });
  expect(response.status).toBe(200); expect(response.headers.get("x-accel-buffering")).toBe("no");
  const parser = new SseDecoder(); const events = parser.push(new TextEncoder().encode(await response.text()));
  expect(events.map(event => event.event)).toEqual(["start", "delta", "error", "done"]);
  expect(events[2]).toMatchObject({ data: { code: "UNAUTHORIZED" } });
});
it("cancels an active server-side generation when the reader disconnects", async () => {
  let activeSignal: AbortSignal | undefined;
  const response = generationResponse(new Request("http://localhost"), { generationId: id, projectId: id, actorId: id }, async stream => {
    activeSignal = stream.signal;
    return new Promise((_resolve, reject) => stream.signal.addEventListener("abort", () => reject(stream.signal.reason), { once: true }));
  });
  const reader = response.body!.getReader(); await reader.read(); await reader.cancel(); expect(activeSignal?.aborted).toBe(true);
});
