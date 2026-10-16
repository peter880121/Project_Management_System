import type { Prisma } from "@prisma/client";

/** Existing project -> all referenced users (UUID order) -> membership/business rows.
 * Global user operations lock users only. Never acquire an existing project after users.
 * Remote IO must stay outside these transactions.
 */
export async function lockProject(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$queryRaw`SELECT id FROM Project WHERE id = ${projectId} FOR UPDATE`;
}

export async function lockUsers(tx: Prisma.TransactionClient, ids: readonly string[]) {
  // MySQL UUID columns use a case-insensitive collation; aliases must share one lock order.
  const orderedIds = [...new Set(ids.map((value) => value.toLowerCase()))].sort();
  for (const id of orderedIds) {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${id} FOR UPDATE`;
  }
}
