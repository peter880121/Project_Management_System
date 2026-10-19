import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown, failAudit: "", user: null as { id: string; role: "PM" | "QA" } | null, model: "valid", beforeModelReturn: undefined as (() => Promise<void>) | undefined }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.db; } }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/modules/ai/chat-model", () => ({ getConfiguredLlm: () => ({ model: {}, modelName: "synthetic-meeting" }) }));
vi.mock("@/modules/ai/streaming/model", () => ({ invokeModelText: async (_model: unknown, _messages: unknown, stream: { signal: AbortSignal }) => { await state.beforeModelReturn?.(); stream.signal.throwIfAborted(); return state.model === "valid" ? JSON.stringify({ summary: "会议明确了合成联调安排。", actionItems: [{ text: "完成联调计划", suggestedAssigneeId: null, suggestedAssigneeName: "张工", expectedDueDate: "2026-10-26" }] }) : "{}"; } }));
import { createMeeting, syncMeeting } from "@/modules/assets/services";
import { editMeeting } from "@/modules/assets/meeting-drafts";
import { createTask } from "@/modules/audit/service";
import { summarizeMeeting } from "@/modules/ai/meetings/service";
import { POST as summarizeRoute } from "@/app/api/projects/[projectId]/meetings/[meetingId]/summarize/route";
import { POST as taskRoute } from "@/app/api/projects/[projectId]/tasks/route";
import { GET as meetingList } from "@/app/api/projects/[projectId]/meetings/route";
import { SseDecoder } from "@/modules/ai/streaming/protocol";
import { storedItemsSchema } from "@/modules/ai/meetings/types";
const db = new PrismaClient();
state.db = db.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (args.data.action === state.failAudit) throw new Error("Synthetic audit outage"); return query(args); } } } });
let projectId: string, pmId: string, memberId: string, outsiderId: string;
const input = () => ({ status: "DRAFT" as const, title: "合成接口联调会议", content: "待整理的合成会议记录", meetingDate: "2026-10-19T02:00:00.000Z", requestKey: randomUUID(), visibleRoles: ["PM" as const], actionItems: [] });
const actor = () => ({ actorId: pmId });
const stream = (signal = new AbortController().signal) => ({ generationId: randomUUID(), signal, emit: vi.fn() });
async function pending() {
  const meeting = await createMeeting(projectId, input(), actor());
  const result = await summarizeMeeting({ projectId, meetingId: meeting.id, actorId: pmId, expectedVersion: 1, text: "张工下周一完成联调计划，全部为合成数据。" }, stream());
  return { meeting, result };
}
describe.sequential("meeting AI and task conversion, real MySQL rollback", () => {
  beforeEach(async () => {
    state.failAudit = ""; state.model = "valid"; state.beforeModelReturn = undefined;
    await db.$transaction(async tx => {
      pmId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "合成 PM", role: "PM", status: "ACTIVE" } })).id;
      memberId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "张明", role: "MEMBER", status: "ACTIVE" } })).id;
      outsiderId = (await tx.user.create({ data: { email: `${randomUUID()}@medpm.local`, name: "外部用户", role: "PM", status: "ACTIVE" } })).id;
      projectId = (await tx.project.create({ data: { name: "合成会议 AI 验收", ownerId: pmId } })).id;
      await tx.projectMember.create({ data: { projectId, userId: memberId } });
    }); state.user = { id: pmId, role: "PM" };
  });
  afterAll(async () => db.$disconnect());
  it("only commits a pending suggestion, never tasks or a changed meeting", async () => {
    const { meeting, result } = await pending();
    expect((await db.meetingRecord.findUniqueOrThrow({ where: { id: meeting.id } })).content).toBe(meeting.content);
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: result.suggestionId } })).status).toBe("PENDING"); expect(await db.task.count({ where: { projectId } })).toBe(0);
    expect(JSON.stringify((await db.aiSuggestion.findUniqueOrThrow({ where: { id: result.suggestionId } })).input)).not.toContain("张工下周一");
  });
  it("atomically converts an item and deduplicates parallel submissions, including stale retries", async () => {
    const { meeting, result } = await pending(); const body = { projectId, actorId: pmId, title: result.actionItems[0].text, assigneeId: memberId, dueDate: "2026-10-26", meetingSource: { meetingId: meeting.id, actionItemId: result.actionItems[0].id, suggestionId: result.suggestionId, expectedVersion: 1, visibilityExpansionConfirmed: true as const } };
    const [first, second] = await Promise.all([createTask(body), createTask(body)]); expect(first.id).toBe(second.id);
    expect(await db.task.count({ where: { projectId } })).toBe(1); expect(first.dueDate?.toISOString()).toBe("2026-10-26T23:59:59.999Z"); expect(first.assigneeId).toBe(memberId);
    const row = await db.meetingRecord.findUniqueOrThrow({ where: { id: meeting.id } }); expect(row.rowVersion).toBe(2); expect(storedItemsSchema.parse(row.actionItems)[0].taskId).toBe(first.id);
    expect(await db.auditLog.count({ where: { projectId, action: "MEETING_ACTION_ITEM_CONVERTED" } })).toBe(1);
  });
  it("rolls back task, link and all audits if the final audit insert fails", async () => {
    const { meeting, result } = await pending(); state.failAudit = "MEETING_ACTION_ITEM_CONVERTED";
    await expect(createTask({ projectId, actorId: pmId, title: "合成任务", assigneeId: memberId, meetingSource: { meetingId: meeting.id, actionItemId: result.actionItems[0].id, suggestionId: result.suggestionId, expectedVersion: 1, visibilityExpansionConfirmed: true } })).rejects.toThrow("Synthetic audit outage");
    expect(await db.task.count({ where: { projectId } })).toBe(0); expect((await db.meetingRecord.findUniqueOrThrow({ where: { id: meeting.id } })).actionItems).toEqual([]); expect(await db.auditLog.count({ where: { projectId, action: "TASK_CREATED" } })).toBe(0);
  });
  it("applies the bundle without losing a converted link, finalizes, then refuses editing and generation", async () => {
    const { meeting, result } = await pending(); const task = await createTask({ projectId, actorId: pmId, title: "合成任务", meetingSource: { meetingId: meeting.id, actionItemId: result.actionItems[0].id, suggestionId: result.suggestionId, expectedVersion: 1, visibilityExpansionConfirmed: true } });
    const applied = await editMeeting(projectId, meeting.id, { action: "apply", expectedVersion: 2, suggestionId: result.suggestionId }, actor()); expect(storedItemsSchema.parse(applied.actionItems)[0].taskId).toBe(task.id); expect(applied.content).toBe(result.summary);
    await editMeeting(projectId, meeting.id, { action: "finalize", expectedVersion: 3 }, actor());
    await expect(editMeeting(projectId, meeting.id, { action: "save", expectedVersion: 4, title: "篡改", content: "篡改", meetingDate: input().meetingDate }, actor())).rejects.toMatchObject({ status: 409 });
    await expect(summarizeMeeting({ projectId, meetingId: meeting.id, actorId: pmId, expectedVersion: 4, text: "新的合成会议记录，需要提炼。" }, stream())).rejects.toMatchObject({ status: 409 });
  });
  it("rejects stale content, versions, forged item IDs and out-of-project owners", async () => {
    const { meeting, result } = await pending();
    await expect(createTask({ projectId, actorId: pmId, title: "合成任务", assigneeId: outsiderId, meetingSource: { meetingId: meeting.id, actionItemId: result.actionItems[0].id, suggestionId: result.suggestionId, expectedVersion: 1, visibilityExpansionConfirmed: true } })).rejects.toMatchObject({ status: 400 });
    await expect(createTask({ projectId, actorId: pmId, title: "合成任务", meetingSource: { meetingId: meeting.id, actionItemId: randomUUID(), suggestionId: result.suggestionId, expectedVersion: 1, visibilityExpansionConfirmed: true } })).rejects.toMatchObject({ status: 400 });
    await editMeeting(projectId, meeting.id, { action: "save", expectedVersion: 1, title: meeting.title, content: "合成会议正文已修改", meetingDate: input().meetingDate }, actor());
    await expect(editMeeting(projectId, meeting.id, { action: "apply", expectedVersion: 1, suggestionId: result.suggestionId }, actor())).rejects.toMatchObject({ status: 409 });
    await expect(editMeeting(projectId, meeting.id, { action: "apply", expectedVersion: 2, suggestionId: result.suggestionId }, actor())).rejects.toMatchObject({ status: 409 });
    expect(await db.task.count({ where: { projectId } })).toBe(0);
  });
  it("returns real HTTP errors before streaming for long input and forbidden actors", async () => {
    const meeting = await createMeeting(projectId, input(), actor()); const params = Promise.resolve({ projectId, meetingId: meeting.id });
    const request = (text: string) => new Request(`http://localhost/api/projects/${projectId}/meetings/${meeting.id}/summarize`, { method: "POST", body: JSON.stringify({ text, expectedVersion: 1, syntheticDataConfirmed: true }) });
    const tooLong = await summarizeRoute(request("会".repeat(8001)), { params }); expect(tooLong.status).toBe(413); expect(await tooLong.json()).toEqual({ error: "文本过长，请分段提炼" }); expect(tooLong.headers.get("content-type")).not.toContain("event-stream");
    state.user = null; expect((await summarizeRoute(request("合成会议记录，整理联调计划。"), { params })).status).toBe(401);
    state.user = { id: outsiderId, role: "PM" }; expect((await summarizeRoute(request("合成会议记录，整理联调计划。"), { params })).status).toBe(403);
    state.user = { id: memberId, role: "QA" }; expect((await summarizeRoute(request("合成会议记录，整理联调计划。"), { params })).status).toBe(403);
    const list = await meetingList(new Request("http://localhost/?page=1"), { params: Promise.resolve({ projectId }) }); expect((await list.json()).data).toEqual([]);
  });
  it("rechecks revocation at stream commit and emits UNAUTHORIZED without saving", async () => {
    const meeting = await createMeeting(projectId, input(), actor()); state.beforeModelReturn = () => db.$transaction(tx => tx.user.update({ where: { id: pmId }, data: { role: "MEMBER" } })).then(() => {});
    const response = await summarizeRoute(new Request(`http://localhost/api/projects/${projectId}/meetings/${meeting.id}/summarize`, { method: "POST", body: JSON.stringify({ text: "合成会议记录，张工完成联调计划。", expectedVersion: 1, syntheticDataConfirmed: true }) }), { params: Promise.resolve({ projectId, meetingId: meeting.id }) });
    const events = new SseDecoder().push(new TextEncoder().encode(await response.text())); expect(events).toContainEqual({ event: "error", data: expect.objectContaining({ code: "UNAUTHORIZED", status: 403 }) }); expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0);
  });
  it("cancels before save, and invalid output leaves no suggestion or task", async () => {
    const meeting = await createMeeting(projectId, input(), actor()); const ac = new AbortController(); state.beforeModelReturn = async () => { ac.abort(new DOMException("cancel", "AbortError")); };
    await expect(summarizeMeeting({ projectId, meetingId: meeting.id, actorId: pmId, expectedVersion: 1, text: "合成会议转写，需要人工确认。" }, stream(ac.signal))).rejects.toMatchObject({ name: "AbortError" });
    state.beforeModelReturn = undefined; state.model = "invalid";
    await expect(summarizeMeeting({ projectId, meetingId: meeting.id, actorId: pmId, expectedVersion: 1, text: "合成会议转写，需要人工确认。" }, stream())).rejects.toMatchObject({ status: 422 });
    expect(await db.aiSuggestion.count({ where: { projectId } })).toBe(0); expect(await db.task.count({ where: { projectId } })).toBe(0);
  });
  it("refuses draft indexing, preserves historical finalized default and archived freeze", async () => {
    const meeting = await createMeeting(projectId, input(), actor()); await expect(syncMeeting(meeting.id, actor())).rejects.toMatchObject({ status: 400 });
    const { status: _status, ...oldInput } = input(); const historical = await createMeeting(projectId, oldInput, actor()); expect(historical.status).toBe("FINALIZED");
    await db.$transaction(tx => tx.project.update({ where: { id: projectId }, data: { status: "ARCHIVED" } }));
    const response = await taskRoute(new Request(`http://localhost/api/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify({ title: "合成任务" }) }), { params: Promise.resolve({ projectId }) }); expect(response.status).toBe(403);
    await expect(db.$transaction(tx => tx.meetingRecord.update({ where: { id: meeting.id }, data: { content: "SQL bypass" } }))).rejects.toThrow(/ER_ARCHIVED_PROJECT/);
  });
});
