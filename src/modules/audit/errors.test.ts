import { Prisma } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { ProjectAccessError } from "@/modules/auth/project-access";
import { BusinessError, businessErrorResponse } from "./errors";

it.each([
  new Error("synthetic private database detail"),
  new Prisma.PrismaClientKnownRequestError("synthetic private SQL", { code: "P2010", clientVersion: "test", meta: { message: "synthetic credential" } }),
  { message: "synthetic private object" },
])("does not expose unexpected exceptions", async (error) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = businessErrorResponse(error);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "操作失败，请稍后重试" });
    expect(log).toHaveBeenCalledWith("Audited business operation failed");
  } finally { log.mockRestore(); }
});
it.each(["P2034", "P2002"])("maps %s to a safe conflict without exposing metadata", async (code) => {
  const response = businessErrorResponse(new Prisma.PrismaClientKnownRequestError("private SQL", { code, clientVersion: "test" }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "数据存在并发冲突，请刷新后重试" });
});
it.each([new BusinessError("Task not found", 404), new ProjectAccessError("Forbidden", 403)])("preserves explicitly safe business errors", async (error) => {
  const response = businessErrorResponse(error);
  expect(response.status).toBe(error.status);
  expect(await response.json()).toEqual({ error: error.message });
});

it("maps closed transactions to retryable 503", async () => {
  const response = businessErrorResponse(new Prisma.PrismaClientKnownRequestError("private transaction stack", { code: "P2028", clientVersion: "test" }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "系统繁忙，请重试" });
});
