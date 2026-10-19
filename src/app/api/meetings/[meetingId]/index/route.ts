import { assetResourceHttp } from "@/modules/assets/resource-http";
import { syncMeeting } from "@/modules/assets/services";
import { syncSchema } from "@/modules/assets/validation";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params;
  return assetResourceHttp("meeting", meetingId, ["PM", "ADMIN"], async user => {
    syncSchema.parse(await request.json()); return Response.json({ data: await syncMeeting(meetingId, { actorId: user.id, ...getAuditRequestMetadata(request) }) });
  }, request);
}
