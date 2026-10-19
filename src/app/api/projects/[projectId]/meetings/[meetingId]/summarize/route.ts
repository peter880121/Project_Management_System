import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assetHttp } from "@/modules/assets/http";
import { ProjectError } from "@/modules/projects/services";
import { projectErrorResponse } from "@/modules/projects/http";
import { getAuditRequestMetadata } from "@/modules/audit/request-metadata";
import { generationId, generationResponse } from "@/modules/ai/streaming/response";
import { containsSensitiveMeetingInput } from "@/modules/ai/meetings/privacy";
import { meetingContext, summarizeMeeting } from "@/modules/ai/meetings/service";
import { summarizeSchema, transcriptFits, TOO_LONG_MESSAGE } from "@/modules/ai/meetings/types";
import { canReadRoles } from "@/modules/assets/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string; meetingId: string }> };
export async function POST(request: Request, { params }: Context) {
  const { projectId, meetingId } = await params;
  return assetHttp(projectId, ["PM"], async user => {
    z.uuid().parse(meetingId);
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "text" in body && typeof body.text === "string" && !transcriptFits(body.text)) return Response.json({ error: TOO_LONG_MESSAGE }, { status: 413 });
    const input = summarizeSchema.parse(body);
    try {
      const context = await meetingContext(projectId, meetingId, user.id, input.expectedVersion);
      if (containsSensitiveMeetingInput(input.text) || containsSensitiveMeetingInput(context.meeting.title)) throw new ProjectError("请移除敏感信息，仅使用合成数据", 400);
      const id = generationId(request);
      if (await prisma.aiSuggestion.findUnique({ where: { id }, select: { id: true } })) throw new ProjectError("生成请求已完成，请刷新待确认建议", 409);
      const contextCharacters = JSON.stringify({ title: context.meeting.title, members: context.members }).length + 2500;
      const contextTokens = Number(process.env.AI_CONTEXT_WINDOW_TOKENS || 32000);
      if (!Number.isFinite(contextTokens) || !transcriptFits(input.text, contextTokens, contextCharacters)) throw new ProjectError(TOO_LONG_MESSAGE, 413);
      return generationResponse(request, { generationId: id, projectId, meetingId, actorId: user.id, ...getAuditRequestMetadata(request) }, stream => summarizeMeeting({ projectId, meetingId, actorId: user.id, ...input, ...getAuditRequestMetadata(request) }, stream));
    } catch (error) { return projectErrorResponse(error); }
  }, request);
}
export async function GET(_request: Request, { params }: Context) {
  const { projectId, meetingId } = await params;
  return assetHttp(projectId, ["PM"], async user => {
    z.uuid().parse(meetingId);
    const meeting = await prisma.meetingRecord.findFirst({ where: { id: meetingId, projectId } });
    if (!meeting) return Response.json({ error: "会议不存在" }, { status: 404 });
    if (!canReadRoles(meeting.visibleRoles, user.role)) return Response.json({ error: "无权访问此纪要" }, { status: 403 });
    const rows = await prisma.aiSuggestion.findMany({ where: { projectId, type: "MEETING_SUMMARY", status: "PENDING", input: { path: "$.meetingId", equals: meetingId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5, select: { output: true } });
    return Response.json({ data: rows.map(row => row.output) });
  });
}
