import { prisma } from "@/lib/prisma";
import { ProjectFrozenError } from "./freeze";
export async function assertProjectWritable(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (project?.status === "ARCHIVED") throw new ProjectFrozenError();
  if (project?.status === "PENDING_ACCEPTANCE") throw new ProjectFrozenError(false);
}
export function requestChangesBusiness(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const path = new URL(request.url).pathname;
  // Explicit append-only/read operations. All unrecognized project writes are guarded.
  return !/\/(activate|submit-acceptance|qa-approve|archive|reject-acceptance|withdraw-acceptance|exports|report|search)$/.test(path) && !/^\/api\/(project-notifications|notifications)\//.test(path);
}
