import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
import { loginTransaction, LoginBusyError } from "./login-transactions";
const conflict = () => new Prisma.PrismaClientKnownRequestError("Synthetic conflict", { code: "P2034", clientVersion: "test" });
describe("bounded login transaction retries", () => {
  beforeEach(() => vi.resetAllMocks());
  it("retries rolled-back conflicts with READ COMMITTED and returns the committed result", async () => {
    transaction.mockRejectedValueOnce(conflict()).mockResolvedValueOnce("committed");
    const callback = vi.fn();
    expect(await loginTransaction(callback)).toBe("committed");
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledWith(callback, { isolationLevel: "ReadCommitted" });
  });
  it("stops after three conflicts", async () => {
    transaction.mockRejectedValue(conflict());
    await expect(loginTransaction(vi.fn())).rejects.toBeInstanceOf(LoginBusyError);
    expect(transaction).toHaveBeenCalledTimes(3);
  });
  it.each([new Error("audit failed"), new Prisma.PrismaClientKnownRequestError("Synthetic constraint error", { code: "P2002", clientVersion: "test" })])("does not retry non-conflict errors", async (error) => {
    transaction.mockRejectedValue(error);
    await expect(loginTransaction(vi.fn())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledOnce();
  });
});
