import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class LoginBusyError extends Error {}

/** Retry only transactions MySQL/Prisma explicitly rolled back for a conflict. */
export async function loginTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") throw error;
      if (attempt === 2) throw new LoginBusyError("Login transaction conflicts exhausted");
      await delay(10 * (attempt + 1));
    }
  }
  throw new LoginBusyError("Login transaction conflicts exhausted");
}

/** Serialize account state changes before reading counters; never hold this lock during bcrypt. */
export async function lockLoginUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
}
