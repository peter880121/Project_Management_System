import { prisma } from "@/lib/prisma";
import { assetResourceHttp } from "@/modules/assets/resource-http";
import { assetIndexStatus } from "@/modules/assets/services";
import { roles, canReadRoles, AssetError } from "@/modules/assets/validation";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params;
  return assetResourceHttp("meeting", meetingId, [...roles], async user => {
    const row = await prisma.meetingRecord.findUniqueOrThrow({ where: { id: meetingId } });
    if (row.status === "DRAFT" && !["PM", "ADMIN"].includes(user.role) || !canReadRoles(row.visibleRoles, user.role)) throw new AssetError("无权查看此会议纪要", 403);
    return Response.json({ data: { ...row, indexStatus: await assetIndexStatus(row.documentId) } });
  });
}
