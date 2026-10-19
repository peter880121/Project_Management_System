import { z } from "zod";
import { assetHttp } from "@/modules/assets/http";
import { editMeeting, meetingEditSchema } from "@/modules/assets/meeting-drafts";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { projectErrorResponse } from "@/modules/projects/http";
type Context = { params: Promise<{ projectId: string; meetingId: string }> };
export async function PATCH(request: Request, { params }: Context) {
  const { projectId, meetingId } = await params;
  return assetHttp(projectId, ["PM"], async user => {
    z.uuid().parse(meetingId); const input = meetingEditSchema.parse(await request.json());
    try { return Response.json({ data: await editMeeting(projectId, meetingId, input, { actorId: user.id, ...getAuditRequestMetadata(request) }) }); }
    catch (error) { return projectErrorResponse(error); }
  }, request);
}
