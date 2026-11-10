import { prisma } from "@/lib/prisma";
import { assertProjectStatusWritable } from "./freeze";
export async function assertProjectWritable(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
  assertProjectStatusWritable(project?.status);
}
export function requestChangesBusiness(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const path = new URL(request.url).pathname;
  // Explicit append-only/read operations. All unrecognized project writes are guarded.
  return !/\/(pause|resume|cancel|activate|submit-acceptance|qa-approve|archive|reject-acceptance|withdraw-acceptance|exports|report|search)$/.test(path) && !/^\/api\/(project-notifications|notifications)\//.test(path);
}
