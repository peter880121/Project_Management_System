import type { Prisma } from "@prisma/client";
import { ProjectFrozenError } from "@/modules/projects/freeze";

/** Existing project -> all referenced users (UUID order) -> membership/business rows.
 * Global user operations lock users only. Never acquire an existing project after users.
 * Remote IO must stay outside these transactions.
 */
export async function lockProject(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$queryRaw`SELECT id FROM Project WHERE id = ${projectId} FOR UPDATE`;
}

/** Locking read sees a concurrent archive commit, including under RepeatableRead. */
export async function lockProjectForWrite(tx: Prisma.TransactionClient, projectId: string, worker = false) {
  const [project] = await tx.$queryRaw<{ status: string }[]>`SELECT id, status FROM Project WHERE id = ${projectId} FOR UPDATE`;
  if (project?.status === "ARCHIVED") throw new ProjectFrozenError();
  if (!worker && project?.status === "PENDING_ACCEPTANCE") throw new ProjectFrozenError(false);
}

export async function lockUsers(tx: Prisma.TransactionClient, ids: readonly string[]) {
  // MySQL UUID columns use a case-insensitive collation; aliases must share one lock order.
  const orderedIds = [...new Set(ids.map((value) => value.toLowerCase()))].sort();
  for (const id of orderedIds) {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${id} FOR UPDATE`;
  }
}
